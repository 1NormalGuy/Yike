import { writeFile } from "node:fs/promises";

const DEBUG_URL = process.env.DEBUG_URL || "http://127.0.0.1:9222";
const VIEWPORT_WIDTH = Number(process.env.VIEWPORT_WIDTH || 1280);
const VIEWPORT_HEIGHT = Number(process.env.VIEWPORT_HEIGHT || 720);
const screenshots = {
  start: "/tmp/gift-start.png",
  film: "/tmp/gift-film.png",
  hub: "/tmp/gift-hub.png",
  dog: "/tmp/gift-dog.png",
  match: "/tmp/gift-match.png",
  aitips: "/tmp/gift-aitips.png",
  blind: "/tmp/gift-blind-100.png",
  unlock: "/tmp/gift-unlock.png",
  final: "/tmp/gift-final.png"
};

const targets = await fetch(`${DEBUG_URL}/json`).then((response) => response.json());
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error("No debuggable page target found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const browserErrors = [];

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
    return;
  }

  if (message.method === "Runtime.exceptionThrown") {
    browserErrors.push(message.params.exceptionDetails.text);
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    browserErrors.push(message.params.entry.text);
  }
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text);
  }
  return response.result.value;
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(expression, timeout = 10000, interval = 100) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await evaluate(expression)) return;
    await delay(interval);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function pointFor(selector) {
  const point = await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Missing selector: ${selector}`);
  return point;
}

async function click(selector) {
  const point = await pointFor(selector);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1
  });
  await delay(320);
}

async function screenshot(path) {
  const result = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path, Buffer.from(result.data, "base64"));
}

async function activeScene() {
  return evaluate("document.querySelector('.scene.active')?.dataset.scene");
}

async function waitForScene(name, timeout = 10000) {
  await waitFor(`document.querySelector('.scene.active')?.dataset.scene === '${name}'`, timeout);
  await delay(320);
}

async function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: VIEWPORT_WIDTH,
  height: VIEWPORT_HEIGHT,
  deviceScaleFactor: 1,
  mobile: false,
  screenOrientation: { angle: 90, type: "landscapePrimary" }
});
await send("Log.clear");
browserErrors.length = 0;

await evaluate("localStorage.clear()");
await send("Page.reload", { ignoreCache: true });
await waitFor("document.readyState !== 'loading'");
await waitForScene("start");
await waitFor("document.querySelector('.film-gallery').dataset.filmReady === 'true'");
await screenshot(screenshots.start);

if (process.env.FILM_ONLY === "1") {
  const filmMotion = await evaluate(`new Promise((resolve) => {
    const frame = document.querySelector('.film-ring-outer .film-frame');
    const twistFrames = [...document.querySelectorAll('.film-ring-outer .film-frame')];
    const samples = [];
    const twistSides = new Map(twistFrames.map((node) => [node, new Set()]));
    let minimumTrackedTwist = 1;
    const startedAt = performance.now();
    const sample = (now) => {
      const rect = frame.getBoundingClientRect();
      twistFrames.forEach((node) => {
        const trackedTwist = node._filmTwist ?? 1;
        twistSides.get(node).add(Math.sign(trackedTwist));
        minimumTrackedTwist = Math.min(minimumTrackedTwist, Math.abs(trackedTwist));
      });
      samples.push({
        time: now,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      });
      if (now - startedAt < 1800) {
        requestAnimationFrame(sample);
        return;
      }
      const speeds = [];
      for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1];
        const current = samples[index];
        const elapsed = (current.time - previous.time) / 1000;
        if (elapsed <= 0 || elapsed > .05) continue;
        speeds.push(Math.hypot(current.x - previous.x, current.y - previous.y) / elapsed);
      }
      const average = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
      const variance = speeds.reduce((sum, speed) => sum + (speed - average) ** 2, 0) / speeds.length;
      resolve({
        samples: samples.length,
        averageSpeed: average,
        speedDeviation: Math.sqrt(variance),
        coefficientOfVariation: Math.sqrt(variance) / average,
        maxAxisAngle: Math.max(
          ...[...document.querySelectorAll('.film-frame')]
            .map((node) => Math.abs(node._filmAxisAngle || 0))
        ),
        hasFrontAndBack: (
          document.querySelectorAll('.film-frame.film-back').length > 0 &&
          document.querySelectorAll('.film-frame:not(.film-back)').length > 0
        ),
        trackedTwistCrossed: [...twistSides.values()]
          .some((sides) => sides.has(-1) && sides.has(1)),
        minimumTrackedTwist,
        narrowestTwist: Math.min(
          ...[...document.querySelectorAll('.film-frame')]
            .map((node) => Math.abs(node._filmTwist ?? 1))
        ),
        photosPreserveRatio: [...document.querySelectorAll('.film-frame')]
          .every((filmFrame) => {
            const image = filmFrame.querySelector('img');
            const style = getComputedStyle(filmFrame);
            const contentWidth =
              filmFrame.offsetWidth -
              parseFloat(style.paddingLeft) -
              parseFloat(style.paddingRight) -
              parseFloat(style.borderLeftWidth) -
              parseFloat(style.borderRightWidth);
            const contentHeight =
              filmFrame.offsetHeight -
              parseFloat(style.paddingTop) -
              parseFloat(style.paddingBottom) -
              parseFloat(style.borderTopWidth) -
              parseFloat(style.borderBottomWidth);
            const renderedRatio = contentWidth / contentHeight;
            const naturalRatio = image.naturalWidth / image.naturalHeight;
            return Number.isFinite(naturalRatio) &&
              Math.abs(renderedRatio - naturalRatio) < .025;
          }),
        photosFillFrames: [...document.querySelectorAll('.film-frame img')]
          .every((image) => {
            const style = getComputedStyle(image);
            const frameStyle = getComputedStyle(image.parentElement);
            const contentWidth =
              image.parentElement.clientWidth -
              parseFloat(frameStyle.paddingLeft) -
              parseFloat(frameStyle.paddingRight);
            const contentHeight =
              image.parentElement.clientHeight -
              parseFloat(frameStyle.paddingTop) -
              parseFloat(frameStyle.paddingBottom);
            return style.objectFit === 'cover' &&
              Math.abs(image.offsetWidth - contentWidth) < 1.1 &&
              Math.abs(image.offsetHeight - contentHeight) < 1.1;
          }),
        enterLayeredInsideFilm: (() => {
          const enterZ = Number(getComputedStyle(document.querySelector('.start-copy')).zIndex);
          const innerFrames = [...document.querySelectorAll('.film-ring-inner .film-frame')];
          const outerFrames = [...document.querySelectorAll('.film-ring-outer .film-frame')];
          const innerFront = innerFrames
            .filter((node) => !node.classList.contains('film-back'))
            .map((node) => Number(getComputedStyle(node).zIndex) || 0);
          const innerBack = innerFrames
            .filter((node) => node.classList.contains('film-back'))
            .map((node) => Number(getComputedStyle(node).zIndex) || 0);
          return innerFront.length > 0 &&
            innerBack.length > 0 &&
            Math.max(...innerBack) < enterZ &&
            Math.min(...innerFront) > enterZ &&
            Math.max(
              ...outerFrames.map((node) => Number(getComputedStyle(node).zIndex) || 0)
            ) < enterZ;
        })(),
        ringsCenteredOnEnter: (() => {
          const panelRect = document.querySelector('.start-copy').getBoundingClientRect();
          const panelCenterX = panelRect.left + panelRect.width / 2;
          const panelCenterY = panelRect.top + panelRect.height / 2;
          const galleryRect = document.querySelector('.film-gallery').getBoundingClientRect();
          return [...document.querySelectorAll('.film-stage')].every((stage) => {
            const centerX = galleryRect.left + Number(stage.dataset.centerX);
            const centerY = galleryRect.top + Number(stage.dataset.centerY);
            return Math.abs(centerX - panelCenterX) < .5 &&
              Math.abs(centerY - panelCenterY) < .5;
          });
        })(),
        ringsCrossInRequestedDirections: (() => {
          const inner = document.querySelector('.film-stage-inner');
          const outer = document.querySelector('.film-stage-outer');
          const innerAngle = Number(
            getComputedStyle(inner).getPropertyValue('--orbit-angle').replace('deg', '')
          );
          const outerAngle = Number(
            getComputedStyle(outer).getPropertyValue('--orbit-angle').replace('deg', '')
          );
          return (
            innerAngle > 0 &&
            outerAngle < 0 &&
            Number(outer.dataset.majorRadius) > Number(inner.dataset.majorRadius) &&
            Number(outer.dataset.minorRadius) > Number(inner.dataset.minorRadius)
          );
        })(),
        innerFilmCrossesEnter: (() => {
          const panelRect = document.querySelector('.start-copy').getBoundingClientRect();
          const overlapArea = (frame) => {
            const rect = frame.getBoundingClientRect();
            const width = Math.max(
              0,
              Math.min(rect.right, panelRect.right) - Math.max(rect.left, panelRect.left)
            );
            const height = Math.max(
              0,
              Math.min(rect.bottom, panelRect.bottom) - Math.max(rect.top, panelRect.top)
            );
            return width * height;
          };
          const innerFrames = [...document.querySelectorAll('.film-ring-inner .film-frame')];
          return {
            front: innerFrames
              .filter((node) => !node.classList.contains('film-back'))
              .some((node) => overlapArea(node) > 120),
            back: innerFrames
              .filter((node) => node.classList.contains('film-back'))
              .some((node) => overlapArea(node) > 120)
          };
        })(),
        filmCrossingLayered: (() => {
          const inner = document.querySelector('.film-stage-inner');
          const outer = document.querySelector('.film-stage-outer');
          const geometry = (stage) => ({
            major: Number(stage.dataset.majorRadius),
            minor: Number(stage.dataset.minorRadius),
            angle: Number(
              getComputedStyle(stage).getPropertyValue('--orbit-angle').replace('deg', '')
            ) * Math.PI / 180
          });
          const point = (shape, angle) => {
            const x = Math.cos(angle) * shape.major;
            const y = Math.sin(angle) * shape.minor;
            return {
              x: x * Math.cos(shape.angle) - y * Math.sin(shape.angle),
              y: x * Math.sin(shape.angle) + y * Math.cos(shape.angle)
            };
          };
          const innerShape = geometry(inner);
          const outerShape = geometry(outer);
          let minimum = Infinity;
          const samples = 240;
          for (let innerIndex = 0; innerIndex < samples; innerIndex += 1) {
            const innerPoint = point(innerShape, innerIndex / samples * Math.PI * 2);
            for (let outerIndex = 0; outerIndex < samples; outerIndex += 1) {
              const outerPoint = point(outerShape, outerIndex / samples * Math.PI * 2);
              minimum = Math.min(
                minimum,
                Math.hypot(innerPoint.x - outerPoint.x, innerPoint.y - outerPoint.y)
              );
            }
          }
          const innerHeight = Math.max(
            ...[...document.querySelectorAll('.film-ring-inner .film-frame')]
              .map((node) => node.offsetHeight)
          );
          const outerHeight = Math.max(
            ...[...document.querySelectorAll('.film-ring-outer .film-frame')]
              .map((node) => node.offsetHeight)
          );
          const crossingDistance = (innerHeight + outerHeight) * .48;
          const innerZ = [...document.querySelectorAll('.film-ring-inner .film-frame')]
            .map((node) => Number(getComputedStyle(node).zIndex) || 0);
          const outerZ = [...document.querySelectorAll('.film-ring-outer .film-frame')]
            .map((node) => Number(getComputedStyle(node).zIndex) || 0);
          return {
            minimum,
            crossingDistance,
            crosses: minimum < crossingDistance,
            layered: Math.min(...innerZ) > Math.max(...outerZ)
          };
        })()
      });
    };
    requestAnimationFrame(sample);
  })`);
  await assert(filmMotion.samples >= 45, "Film animation produced too few frames");
  await assert(
    filmMotion.averageSpeed > 55 && filmMotion.averageSpeed < 95,
    `Film animation speed was outside the expected range: ${filmMotion.averageSpeed}`
  );
  await assert(
    filmMotion.coefficientOfVariation < 0.22,
    `Film animation speed was uneven: ${filmMotion.coefficientOfVariation}`
  );
  await assert(filmMotion.maxAxisAngle <= 90.01, "A film photo rotated upside down");
  await assert(filmMotion.hasFrontAndBack, "Film strip did not expose both faces");
  await assert(filmMotion.trackedTwistCrossed, "A film frame did not pass through the twist");
  await assert(filmMotion.minimumTrackedTwist < 0.03, "Film twist did not become edge-on smoothly");
  await assert(filmMotion.photosPreserveRatio, "Film photos did not preserve their aspect ratios");
  await assert(filmMotion.photosFillFrames, "Film photos left empty bars inside their frames");
  await assert(filmMotion.enterLayeredInsideFilm, "ENTER was not between the inner film faces");
  await assert(filmMotion.ringsCenteredOnEnter, "Film rings were not centered on ENTER");
  await assert(
    filmMotion.ringsCrossInRequestedDirections,
    "Film rings did not cross in the requested directions"
  );
  await assert(
    filmMotion.innerFilmCrossesEnter.front && filmMotion.innerFilmCrossesEnter.back,
    "Inner film did not pass both in front of and behind ENTER"
  );
  await assert(filmMotion.filmCrossingLayered.crosses, "Film rings did not form a crossing layout");
  await assert(filmMotion.filmCrossingLayered.layered, "Film crossing had no stable depth order");
  await screenshot(screenshots.film);
  console.log(JSON.stringify({ filmMotion, browserErrors, screenshot: screenshots.film }, null, 2));
  socket.close();
  process.exit(0);
}

await click("#start-button");
await waitForScene("hub");
await assert(await evaluate("document.querySelector('#hub-progress').textContent.trim() === '0 / 5'"), "Hub did not start at 0 / 5");
await assert(
  await evaluate("[...document.querySelectorAll('.reward-frame img')].every((img) => getComputedStyle(img).visibility === 'hidden')"),
  "A secret gift was visible before its game was completed"
);
await assert(
  await evaluate(`(() => {
    const shell = document.querySelector('#game-shell');
    const gate = document.querySelector('#summon-gate');
    let expectedX = 0;
    let expectedY = 0;
    let node = gate;
    while (node && node !== shell) {
      expectedX += node.offsetLeft;
      expectedY += node.offsetTop;
      node = node.offsetParent;
    }
    const circle = window.magic.getCircle();
    return Math.abs(circle.x - expectedX) < 1 &&
      Math.abs(circle.y - expectedY) < 1;
  })()`),
  "Canvas magic rings were not concentric with the summon gate"
);
await screenshot(screenshots.hub);

await click(".hub-entry[data-game='dog']");
await waitForScene("dog");
await assert(
  await evaluate(`(() => {
    const cat = document.querySelector('.bad-cat');
    const image = cat.querySelector('img');
    return getComputedStyle(cat).backgroundColor === 'rgba(0, 0, 0, 0)' &&
      image.getAttribute('src') === 'catDog/cat.png';
  })()`),
  "Dog level target did not use the black cat sprite cleanly"
);
await assert(
  await evaluate("document.querySelector('#dog-ammo-count').textContent.trim() === '3'"),
  "Dog level did not start with the configured ammunition"
);
await assert(
  await evaluate(`(() => {
    const dog = document.querySelector('#dog-projectile').getBoundingClientRect();
    const sling = document.querySelector('.slingshot').getBoundingClientRect();
    return dog.right < sling.left + sling.width * .65 &&
      dog.top > sling.top + sling.height * .2;
  })()`),
  "Ready dog was not placed at the lower-left of the slingshot"
);
await screenshot(screenshots.dog);
let dogShots = 0;
const dogPulls = [
  { x: 105, y: 68 },
  { x: 120, y: 82 },
  { x: 95, y: 55 },
  { x: 130, y: 72 }
];
while (
  (await activeScene()) === "dog" &&
  !(await evaluate("document.querySelector('#reward-unlock').classList.contains('show')")) &&
  dogShots < 15
) {
  await waitFor(
    "document.querySelector('#dog-battle').dataset.ready === 'true' || document.querySelector('#reward-unlock').classList.contains('show')",
    7000
  );
  if (await evaluate("document.querySelector('#reward-unlock').classList.contains('show')")) break;
  const dogPoint = await pointFor("#dog-projectile");
  const pull = dogPulls[dogShots % dogPulls.length];
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: dogPoint.x,
    y: dogPoint.y,
    button: "left",
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: dogPoint.x - pull.x,
    y: dogPoint.y + pull.y,
    button: "left",
    buttons: 1
  });
  await delay(120);
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: dogPoint.x - pull.x,
    y: dogPoint.y + pull.y,
    button: "left",
    clickCount: 1
  });
  dogShots += 1;
  await delay(1200);
}
await waitFor("document.querySelector('#reward-unlock').classList.contains('revealed')", 3000);
await assert(
  await evaluate("document.querySelector('#reward-unlock-title').textContent.includes('Jellycat')"),
  "Dog reward reveal did not identify the unlocked gift"
);
await delay(1200);
await screenshot(screenshots.unlock);
await waitForScene("hub", 8000);
await assert(await evaluate("window.giftSummonGame.getState().completed.dog"), "Dog game did not complete");

if (process.env.ONLY_DOG === "1") {
  console.log(JSON.stringify({
    completed: await evaluate("window.giftSummonGame.getState().completed.dog"),
    browserErrors,
    screenshot: screenshots.dog
  }, null, 2));
  socket.close();
  process.exit(0);
}

await click(".hub-entry[data-game='hand']");
await waitForScene("hand");
await screenshot(screenshots.match);
await assert(
  await evaluate("!document.querySelector('#scene-hand img[src*=\"dior\"]')"),
  "Hand cream gift was exposed inside the game before completion"
);
let matchMoves = 0;
while (
  (await activeScene()) === "hand" &&
  !(await evaluate("document.querySelector('#reward-unlock').classList.contains('show')")) &&
  matchMoves < 30
) {
  const pair = await evaluate(`(() => {
    const tiles = [...document.querySelectorAll('.match-tile:not(.matched)')];
    const groups = new Map();
    for (const tile of tiles) {
      const values = groups.get(tile.dataset.icon) || [];
      values.push({ row: tile.dataset.row, column: tile.dataset.column });
      groups.set(tile.dataset.icon, values);
    }
    return [...groups.values()].find((values) => values.length >= 2)?.slice(0, 2) || null;
  })()`);
  if (!pair) {
    await delay(500);
    continue;
  }
  await click(`.match-tile[data-row='${pair[0].row}'][data-column='${pair[0].column}']`);
  await click(`.match-tile[data-row='${pair[1].row}'][data-column='${pair[1].column}']`);
  matchMoves += 1;
  await delay(250);
}
await waitFor("document.querySelector('#reward-unlock').classList.contains('revealed')", 3000);
await assert(
  await evaluate("document.querySelector('#reward-unlock-title').textContent.includes('Dior')"),
  "Hand cream reward reveal did not identify the unlocked gift"
);
await waitForScene("hub", 8000);
await assert(await evaluate("window.giftSummonGame.getState().completed.hand"), "Hand cream game did not complete");

await click(".hub-entry[data-game='blind']");
await waitForScene("blind");
for (let blindRound = 1; blindRound <= 3; blindRound += 1) {
  await waitFor(
    `document.querySelector('#blind-level-score').textContent.trim() === '${blindRound} / 3' && document.querySelector('#blindbox-board').dataset.ready === 'true'`,
    8000
  );
  const expectedBoxCount = blindRound === 1 ? 3 : blindRound === 2 ? 5 : 100;
  await assert(
    await evaluate(`document.querySelectorAll('.blind-box').length === ${expectedBoxCount}`),
    `Blind box round ${blindRound} rendered the wrong box count`
  );
  if (blindRound < 3) {
    if (blindRound === 1) {
      await click(".blind-box[data-target='false']");
      await waitFor("document.querySelector('#blindbox-board').dataset.ready === 'false'", 2000);
      await waitFor(
        "document.querySelector('#blind-level-score').textContent.trim() === '1 / 3' && document.querySelector('#blindbox-board').dataset.ready === 'true'",
        8000
      );
    }
    await click(".blind-box[data-target='true']");
  } else {
    await screenshot(screenshots.blind);
    await click(".blind-box");
  }
  await delay(1100);
}
await waitFor("document.querySelector('#reward-unlock').classList.contains('revealed')", 4000);
await assert(
  await evaluate("document.querySelector('#reward-unlock-title').textContent.includes('盲盒')"),
  "Blind box reward reveal did not identify the unlocked gift"
);
await waitForScene("hub", 8000);
await assert(await evaluate("window.giftSummonGame.getState().completed.blind"), "Blind box game did not complete");

await click(".hub-entry[data-game='stella']");
await waitForScene("stella");
await waitFor("Boolean(document.querySelector('.falling-item.star'))", 5000);
const starStartY = await evaluate("document.querySelector('.falling-item.star').getBoundingClientRect().top");
await delay(350);
const starEndY = await evaluate("document.querySelector('.falling-item.star').getBoundingClientRect().top");
await assert(starEndY > starStartY + 10, "Stars were not falling downward");
const dragPoint = await pointFor(".touch-strip");
await send("Input.dispatchMouseEvent", {
  type: "mousePressed",
  x: dragPoint.x,
  y: dragPoint.y,
  button: "left",
  clickCount: 1
});

const stellaStartedAt = Date.now();
while (
  (await activeScene()) === "stella" &&
  !(await evaluate("document.querySelector('#reward-unlock').classList.contains('show')")) &&
  Date.now() - stellaStartedAt < 30000
) {
  const starX = await evaluate(`(() => {
    const star = [...document.querySelectorAll('.falling-item.star')]
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.top > 0)
      .sort((a, b) => b.rect.top - a.rect.top)[0];
    return star ? star.rect.left + star.rect.width / 2 : null;
  })()`);
  if (starX !== null) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: starX,
      y: dragPoint.y,
      button: "left",
      buttons: 1
    });
  }
  await delay(55);
}
await send("Input.dispatchMouseEvent", {
  type: "mouseReleased",
  x: dragPoint.x,
  y: dragPoint.y,
  button: "left",
  clickCount: 1
});
await waitFor("document.querySelector('#reward-unlock').classList.contains('revealed')", 3000);
await assert(
  await evaluate("document.querySelector('#reward-unlock-title').textContent.includes('星黛露')"),
  "Stella reward reveal did not identify the unlocked gift"
);
await waitForScene("hub", 8000);
await assert(await evaluate("window.giftSummonGame.getState().completed.stella"), "Stella game did not complete");

await click(".hub-entry[data-game='aitips']");
await waitForScene("aitips");
for (let aiRound = 1; aiRound <= 3; aiRound += 1) {
  await waitFor(
    `document.querySelector('#aitips-level-score').textContent.trim() === '${aiRound} / 3' && document.querySelector('#aitips-board').dataset.ready === 'true'`,
    9000
  );
  if (aiRound === 1) await screenshot(screenshots.aitips);
  const sequence = await evaluate("document.querySelector('#aitips-board').dataset.sequence");
  for (const pad of sequence.split(",")) {
    await click(`.aitips-note[data-pad='${pad}']`);
    await delay(200);
  }
  await delay(900);
}
await waitFor("document.querySelector('#reward-unlock').classList.contains('revealed')", 4000);
await assert(
  await evaluate("document.querySelector('#reward-unlock-title').textContent.includes('便利贴')"),
  "AI sticky note reward reveal did not identify the unlocked gift"
);
await waitForScene("hub", 8000);
await assert(await evaluate("window.giftSummonGame.getState().completed.aitips"), "AI sticky note game did not complete");
await assert(await evaluate("window.giftSummonGame.getState().finalUnlocked"), "Final gate did not unlock");

await click("#summon-gate");
await waitForScene("final");

for (const key of ["0", "0", "0", "0"]) await click(`[data-key='${key}']`);
await click("[data-key='confirm']");
await assert(
  await evaluate("document.querySelector('#password-feedback').textContent.includes('没有回应')"),
  "Wrong password feedback was not shown"
);

for (const key of ["0", "6", "1", "2"]) await click(`[data-key='${key}']`);
await click("[data-key='confirm']");
await waitFor("document.querySelector('#final-reveal').classList.contains('show')", 7000);
await waitFor("window.giftSummonGame.getState().finalCompleted", 7000);
await waitFor("document.querySelector('#final-copy').textContent.endsWith('礼物。')", 4000);
await screenshot(screenshots.final);

await send("Page.reload", { ignoreCache: true });
await waitFor("document.readyState !== 'loading'");
await waitForScene("start");
await click("#start-button");
await waitFor("document.querySelector('#final-reveal').classList.contains('show')");
await assert(
  await evaluate("document.querySelector('#final-copy').textContent.includes('大疆 Pocket 4')"),
  "Completed state did not restore after reload"
);

const result = {
  completed: await evaluate("window.giftSummonGame.getState().completed"),
  finalUnlocked: await evaluate("window.giftSummonGame.getState().finalUnlocked"),
  finalCompleted: await evaluate("window.giftSummonGame.getState().finalCompleted"),
  browserErrors,
  screenshots
};

console.log(JSON.stringify(result, null, 2));
socket.close();
