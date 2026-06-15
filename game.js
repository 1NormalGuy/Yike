(() => {
  "use strict";

  const STORAGE_KEY = "gift-summon-state-v3";
  const PASSWORD = "0612";
  const GAME_KEYS = ["stella", "dog", "hand", "blind", "aitips"];
  const REWARDS = {
    stella: {
      title: "星黛露娃娃",
      image: "gifts/disneyxdl.png"
    },
    dog: {
      title: "Jellycat 金色小狗",
      image: "gifts/jcdog.png"
    },
    hand: {
      title: "Dior 护手霜",
      image: "gifts/dior.png"
    },
    blind: {
      title: "嘎子姐盲盒",
      image: "gifts/zsiga.png"
    },
    aitips: {
      title: "AI 心动便利贴",
      image: "gifts/aitips.png"
    }
  };
  const defaultState = {
    completed: {
      stella: false,
      dog: false,
      hand: false,
      blind: false,
      aitips: false
    },
    finalUnlocked: false,
    finalCompleted: false,
    currentScene: "start",
    password: ""
  };

  let state = loadState();
  let activeScene = "start";
  let cleanups = [];
  let transitionLocked = false;
  // Current uniform scale applied to the fixed design canvas (see
  // syncViewportSize). Pointer events arrive in screen pixels, so drag handlers
  // divide by this to map back into the canvas's 1280x720 logical space.
  let shellScale = 1;
  let resetTapCount = 0;
  let resetTapTimer = 0;
  let startTransitionTimer = 0;
  let startTransitionCleanupTimer = 0;

  const scenes = [...document.querySelectorAll(".scene")];
  const shell = document.querySelector("#game-shell");
  const flash = document.querySelector("#global-flash");
  const startTransition = document.querySelector("#start-transition");
  const startTransitionParticles = document.querySelector("#start-transition-particles");
  const rewardUnlock = document.querySelector("#reward-unlock");
  const homeSong = document.querySelector("#home-song");
  const utilityControls = document.querySelector(".utility-controls");
  const musicToggleButton = document.querySelector("#music-toggle-button");
  const fullscreenButton = document.querySelector("#fullscreen-button");
  const systemToast = document.querySelector("#system-toast");

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const audio = {
    context: null,
    enabled: true,
    init() {
      if (!this.enabled || this.context) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        this.enabled = false;
        return;
      }
      this.context = new AudioContext();
      if (this.context.state === "suspended") this.context.resume();
    },
    tone(frequency = 440, duration = 0.08, type = "square", volume = 0.035, delay = 0) {
      if (!this.context || !this.enabled) return;
      const now = this.context.currentTime + delay;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration);
    },
    click() {
      this.tone(520, 0.045, "square", 0.025);
    },
    collect() {
      this.tone(660, 0.08, "square", 0.035);
      this.tone(880, 0.11, "square", 0.025, 0.07);
    },
    bump() {
      this.tone(120, 0.12, "sawtooth", 0.025);
    },
    success() {
      [523, 659, 784, 1047].forEach((note, index) => {
        this.tone(note, 0.22, "square", 0.035, index * 0.11);
      });
    }
  };

  const LOVE_SONG_SRC = encodeURI("music/请和这样的我恋爱吧.mp3");
  const HOME_SONG_FOREGROUND_VOLUME = 0.42;
  const HOME_SONG_BACKGROUND_VOLUME = 0.14;
  let loveSong = null;
  let homeSongFadeFrame = 0;
  let systemToastTimer = 0;

  if (homeSong) {
    homeSong.volume = HOME_SONG_FOREGROUND_VOLUME;
  }

  function updateMusicButton() {
    if (!musicToggleButton || !homeSong) return;
    const playing = !homeSong.paused;
    musicToggleButton.classList.toggle("playing", playing);
    musicToggleButton.classList.toggle("needs-action", !playing && activeScene === "start");
    musicToggleButton.setAttribute("aria-pressed", String(playing));
    musicToggleButton.textContent = playing ? "暂停音乐" : "播放音乐";
  }

  function setHomeSongVolume(targetVolume, duration = 0, pauseWhenDone = false) {
    if (!homeSong) return;
    window.cancelAnimationFrame(homeSongFadeFrame);
    const target = Math.max(0, Math.min(1, targetVolume));
    const startVolume = homeSong.volume;

    if (duration <= 0 || Math.abs(startVolume - target) < 0.005) {
      homeSong.volume = target;
      if (pauseWhenDone) homeSong.pause();
      updateMusicButton();
      return;
    }

    const startedAt = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      homeSong.volume = startVolume + (target - startVolume) * eased;
      if (progress < 1) {
        homeSongFadeFrame = window.requestAnimationFrame(step);
        return;
      }
      homeSongFadeFrame = 0;
      if (pauseWhenDone) homeSong.pause();
      updateMusicButton();
    };
    homeSongFadeFrame = window.requestAnimationFrame(step);
  }

  async function playHomeSong(volume = activeScene === "start"
    ? HOME_SONG_FOREGROUND_VOLUME
    : HOME_SONG_BACKGROUND_VOLUME) {
    if (!homeSong || state.finalCompleted) return false;
    setHomeSongVolume(volume);
    try {
      await homeSong.play();
      updateMusicButton();
      return true;
    } catch {
      updateMusicButton();
      return false;
    }
  }

  function pauseHomeSong() {
    if (!homeSong || homeSong.paused) return;
    window.cancelAnimationFrame(homeSongFadeFrame);
    homeSongFadeFrame = 0;
    homeSong.pause();
    updateMusicButton();
  }

  function stopHomeSong(duration = 0) {
    if (!homeSong) return;
    setHomeSongVolume(0, duration, true);
  }

  function showSystemToast(message) {
    if (!systemToast) return;
    window.clearTimeout(systemToastTimer);
    systemToast.textContent = message;
    systemToast.classList.remove("show");
    void systemToast.offsetWidth;
    systemToast.classList.add("show");
    systemToastTimer = window.setTimeout(() => {
      systemToast.classList.remove("show");
    }, 4300);
  }

  function playLoveSong() {
    try {
      if (!loveSong) {
        loveSong = new Audio(LOVE_SONG_SRC);
        loveSong.preload = "auto";
      }
      loveSong.currentTime = 0;
      const attempt = loveSong.play();
      if (attempt && typeof attempt.catch === "function") attempt.catch(() => {});
    } catch {
      // Background music is a bonus; never let it break the reveal.
    }
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== "object") return clone(defaultState);
      return {
        ...clone(defaultState),
        ...saved,
        completed: {
          ...defaultState.completed,
          ...(saved.completed || {})
        },
        password: ""
      };
    } catch {
      return clone(defaultState);
    }
  }

  function saveState() {
    state.finalUnlocked = GAME_KEYS.every((key) => state.completed[key]);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        completed: state.completed,
        finalUnlocked: state.finalUnlocked,
        finalCompleted: state.finalCompleted,
        currentScene: state.currentScene
      }));
    } catch {
      // The game remains fully playable when storage is unavailable.
    }
  }

  function addCleanup(callback) {
    cleanups.push(callback);
  }

  function clearScene() {
    cleanups.splice(0).forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        // One failed cleanup should not block the next scene.
      }
    });
  }

  function listen(target, eventName, handler, options) {
    target.addEventListener(eventName, handler, options);
    addCleanup(() => target.removeEventListener(eventName, handler, options));
  }

  function later(callback, delay) {
    const id = window.setTimeout(callback, delay);
    addCleanup(() => window.clearTimeout(id));
    return id;
  }

  function playStartTransition(name, options = {}) {
    if (!startTransition || !startTransitionParticles) {
      showScene(name, options);
      return;
    }

    window.clearTimeout(startTransitionTimer);
    window.clearTimeout(startTransitionCleanupTimer);
    startTransitionParticles.replaceChildren();
    for (let index = 0; index < 56; index += 1) {
      const particle = document.createElement("i");
      const angle = Math.random() * Math.PI * 2;
      const distance = 180 + Math.random() * 620;
      particle.style.setProperty("--particle-x", `${Math.cos(angle) * distance}px`);
      particle.style.setProperty("--particle-y", `${Math.sin(angle) * distance}px`);
      particle.style.setProperty("--particle-size", `${5 + Math.random() * 13}px`);
      particle.style.setProperty("--particle-delay", `${Math.random() * 120}ms`);
      particle.style.setProperty("--particle-duration", `${650 + Math.random() * 300}ms`);
      particle.style.setProperty("--particle-rotation", `${Math.random() * 420 - 210}deg`);
      particle.dataset.shape = index % 4 === 0 ? "star" : "dot";
      startTransitionParticles.appendChild(particle);
    }

    startTransition.classList.remove("show");
    void startTransition.offsetWidth;
    startTransition.classList.add("show");
    window.magic?.burst(640, 360, "sceneEnter");

    startTransitionTimer = window.setTimeout(() => {
      showScene(name, { ...options, force: true });
    }, 430);
    startTransitionCleanupTimer = window.setTimeout(() => {
      startTransition.classList.remove("show");
      startTransitionParticles.replaceChildren();
    }, 1050);
  }

  function showScene(name, options = {}) {
    if (transitionLocked && !options.force) return;
    clearScene();
    hideRewardUnlock();
    scenes.forEach((scene) => scene.classList.toggle("active", scene.dataset.scene === name));
    shell.dataset.scene = name;
    window.magic?.setScene(name);
    if (utilityControls) utilityControls.hidden = !["start", "hub"].includes(name);
    if (musicToggleButton) musicToggleButton.hidden = name !== "start";
    if (name !== "final" && loveSong && !loveSong.paused) {
      loveSong.pause();
    }
    activeScene = name;
    state.currentScene = name;
    state.password = "";
    saveState();

    const enter = sceneEntrances[name];
    if (enter) enter(options);

    // Debounce only real in-game transitions. Forced renders (initial entry,
    // reset) must never leave a lingering lock that swallows the player's very
    // next deliberate tap — e.g. pressing ENTER right after the page loads.
    if (options.force) {
      transitionLocked = false;
    } else {
      transitionLocked = true;
      window.setTimeout(() => {
        transitionLocked = false;
      }, 260);
    }
  }

  function showLevelMessage(element, text) {
    element.textContent = text;
    element.classList.remove("show");
    void element.offsetWidth;
    element.classList.add("show");
  }

  function completeGame(gameKey, message, messageElement) {
    if (transitionLocked) return;
    const wasUnlocked = state.completed[gameKey];
    state.completed[gameKey] = true;
    saveState();
    audio.success();
    showLevelMessage(messageElement, message);
    transitionLocked = true;
    later(() => {
      showRewardUnlock(gameKey, wasUnlocked);
    }, 600);
    later(() => {
      hideRewardUnlock();
      transitionLocked = false;
      showScene("hub", { justCompleted: gameKey });
    }, 3900);
  }

  function showRewardUnlock(gameKey, wasUnlocked) {
    const reward = REWARDS[gameKey];
    if (!reward) return;
    const image = document.querySelector("#reward-unlock-image");
    document.querySelector("#reward-unlock-kicker").textContent =
      wasUnlocked ? "SECRET GIFT REAWAKENED" : "SECRET GIFT UNLOCKED";
    document.querySelector("#reward-unlock-title").textContent = reward.title;
    document.querySelector("#reward-unlock-copy").textContent =
      wasUnlocked ? "礼物能量再次点亮" : "秘密礼物已加入召唤阵";
    image.src = reward.image;
    image.alt = reward.title;
    rewardUnlock.classList.add("show");
    rewardUnlock.setAttribute("aria-hidden", "false");
    later(() => rewardUnlock.classList.add("revealed"), 180);
    later(() => window.magic?.rewardUnlock(640, 300), 220);
  }

  function hideRewardUnlock() {
    rewardUnlock.classList.remove("show", "revealed");
    rewardUnlock.setAttribute("aria-hidden", "true");
  }

  function countCompleted() {
    return GAME_KEYS.filter((key) => state.completed[key]).length;
  }

  function burstAt(container, x, y, count = 8) {
    for (let i = 0; i < count; i += 1) {
      const sparkle = document.createElement("span");
      sparkle.className = "star-burst";
      sparkle.textContent = i % 2 ? "✦" : "·";
      sparkle.style.left = `${x}px`;
      sparkle.style.top = `${y}px`;
      sparkle.style.setProperty("--burst-x", `${(Math.random() - 0.5) * 110}px`);
      container.appendChild(sparkle);
      window.setTimeout(() => sparkle.remove(), 700);
    }
  }

  const DEFAULT_PHOTOS = [
    "photos/演唱会.jpg",
    "photos/登顶.jpg",
    "photos/雪山.jpg"
  ];
  const PHOTO_PATTERN = /\.(?:avif|gif|jpe?g|png|webp)$/i;
  let galleryPhotos = null;

  function normalizePhotoUrls(links, baseUrl) {
    const directoryUrl = new URL("photos/", window.location.href);
    const directoryPath = directoryUrl.pathname.endsWith("/")
      ? directoryUrl.pathname
      : `${directoryUrl.pathname}/`;
    const photos = links.flatMap((href) => {
      try {
        const url = new URL(href, baseUrl);
        if (url.origin !== directoryUrl.origin) return [];
        if (!url.pathname.startsWith(directoryPath) || !PHOTO_PATTERN.test(url.pathname)) return [];
        return [url.href];
      } catch {
        return [];
      }
    });

    return [...new Set(photos)].sort((a, b) =>
      decodeURIComponent(a).localeCompare(decodeURIComponent(b), "zh-CN")
    );
  }

  async function discoverPhotos() {
    if (galleryPhotos) return galleryPhotos;

    try {
      const response = await fetch("photos/", { cache: "no-store" });
      if (response.ok) {
        const html = await response.text();
        const directory = new DOMParser().parseFromString(html, "text/html");
        const links = [...directory.querySelectorAll("a[href]")]
          .map((link) => link.getAttribute("href"))
          .filter(Boolean);
        const found = normalizePhotoUrls(links, response.url);
        if (found.length) {
          galleryPhotos = found;
          return galleryPhotos;
        }
      }
    } catch {
      // Some static hosts disable directory listings; try a manifest next.
    }

    try {
      const response = await fetch("photos/manifest.json", { cache: "no-store" });
      if (response.ok) {
        const list = await response.json();
        if (Array.isArray(list)) {
          const found = normalizePhotoUrls(
            list.filter((name) => typeof name === "string" && name),
            new URL("photos/", window.location.href)
          );
          if (found.length) {
            galleryPhotos = found;
            return galleryPhotos;
          }
        }
      }
    } catch {
      // The bundled photos keep the start screen usable without a listing.
    }

    galleryPhotos = DEFAULT_PHOTOS;
    return galleryPhotos;
  }

  async function loadFilmPhotos(photos) {
    return Promise.all(photos.map((src) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        resolve({
          src,
          ratio: image.naturalWidth > 0 && image.naturalHeight > 0
            ? image.naturalWidth / image.naturalHeight
            : 4 / 3
        });
      };
      image.onerror = () => resolve({ src, ratio: 4 / 3 });
      image.src = src;
    })));
  }

  function shufflePhotos(list) {
    const shuffled = list.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled;
  }

  function buildFilmRing(ring, photos, minimumFrames) {
    if (!ring) return;
    ring.replaceChildren();
    const count = Math.max(minimumFrames, photos.length);
    // Lay the strip out of freshly shuffled passes so the order is different
    // every load and repeated photos never line up in a fixed pattern.
    const frames = [];
    while (frames.length < count) {
      frames.push(...shufflePhotos(photos));
    }
    frames.length = count;
    frames.forEach((photoData, index) => {
      const frame = document.createElement("div");
      frame.className = "film-frame";
      frame.dataset.frameIndex = String(index);
      frame.dataset.ratio = String(photoData.ratio);
      const photo = document.createElement("img");
      photo.loading = "eager";
      photo.decoding = "async";
      photo.draggable = false;
      photo.alt = "";
      photo.src = photoData.src;
      frame.appendChild(photo);
      ring.appendChild(frame);
    });
  }

  async function buildFilmGallery(photos) {
    const filmPhotos = await loadFilmPhotos(photos);
    buildFilmRing(document.querySelector("#film-ring"), filmPhotos, 22);
    buildFilmRing(document.querySelector("#film-ring-inner"), filmPhotos, 16);
  }

  function startFilmOrbit() {
    const gallery = document.querySelector(".film-gallery");
    const startPanel = document.querySelector(".start-copy");
    const TAU = Math.PI * 2;
    const orbits = [
      {
        stage: document.querySelector(".film-stage-inner"),
        ring: document.querySelector("#film-ring-inner"),
        angle: 25,
        panelMajor: 1.04,
        panelMinor: .46,
        frameHeight: .078,
        speed: 62,
        direction: -1,
        initialProgress: .53,
        depth: .28,
        zBack: 30,
        zFront: 170,
        layer: "inner"
      },
      {
        stage: document.querySelector(".film-stage-outer"),
        ring: document.querySelector("#film-ring"),
        angle: -22,
        panelMajor: 1.46,
        panelMinor: .64,
        frameHeight: .125,
        speed: 76,
        direction: 1,
        initialProgress: .07,
        depth: .34,
        zBack: 20,
        zFront: 160,
        layer: "outer"
      }
    ].filter((orbit) => orbit.stage && orbit.ring);
    if (!gallery || !startPanel || !orbits.length) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animationId = 0;
    let lastFrameTime = null;
    let resizeObserver = null;
    let resizeFrame = 0;

    function wrap(value, limit) {
      return ((value % limit) + limit) % limit;
    }

    // Project a point of the orbit's circle into screen space. The orbit is a
    // ring lying on a plane that recedes from the camera: the bottom of the
    // sweep (sin > 0) is the near edge, the top (sin < 0) is the far edge. We
    // scale the whole point about the orbit centre by a depth factor so the
    // near arc swings wide and low while the far arc shrinks and pulls back
    // toward the centre — the foreshortening that makes a flat ellipse read as
    // a ribbon orbiting in space instead of a logo painted on glass.
    function projectOrbit(geometry, angle) {
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const near = (sin + 1) / 2;
      const persp = 1 + sin * geometry.depth;
      const localX = cos * geometry.majorRadius * persp;
      const localY = sin * geometry.minorRadius * persp;
      return {
        x: localX * geometry.cosAngle - localY * geometry.sinAngle,
        y: localX * geometry.sinAngle + localY * geometry.cosAngle,
        near,
        persp
      };
    }

    function buildArcLengthGeometry(majorRadius, minorRadius, orbitAngle, depth) {
      const sampleCount = 1440;
      const angles = new Float64Array(sampleCount + 1);
      const lengths = new Float64Array(sampleCount + 1);
      const geometry = {
        majorRadius,
        minorRadius,
        depth,
        cosAngle: Math.cos(orbitAngle),
        sinAngle: Math.sin(orbitAngle),
        angles,
        lengths,
        totalLength: 0
      };
      let previous = projectOrbit(geometry, 0);

      for (let index = 1; index <= sampleCount; index += 1) {
        const angle = index / sampleCount * TAU;
        const point = projectOrbit(geometry, angle);
        angles[index] = angle;
        lengths[index] = lengths[index - 1] +
          Math.hypot(point.x - previous.x, point.y - previous.y);
        previous = point;
      }

      geometry.totalLength = lengths[sampleCount];
      return geometry;
    }

    function samplePath(geometry, distance) {
      const target = wrap(distance, geometry.totalLength);
      let low = 1;
      let high = geometry.lengths.length - 1;

      while (low < high) {
        const middle = (low + high) >> 1;
        if (geometry.lengths[middle] < target) low = middle + 1;
        else high = middle;
      }

      const upper = low;
      const lower = upper - 1;
      const span = geometry.lengths[upper] - geometry.lengths[lower];
      const mix = span > 0 ? (target - geometry.lengths[lower]) / span : 0;
      const angle = geometry.angles[lower] +
        (geometry.angles[upper] - geometry.angles[lower]) * mix;
      const point = projectOrbit(geometry, angle);
      // Tangent by central difference — the perspective scaling makes the
      // closed-form derivative messy, and a small step is plenty accurate.
      const step = TAU / 2048;
      const ahead = projectOrbit(geometry, angle + step);
      const behind = projectOrbit(geometry, angle - step);
      const tangentX = ahead.x - behind.x;
      const tangentY = ahead.y - behind.y;

      return {
        x: point.x,
        y: point.y,
        angle,
        near: point.near,
        persp: point.persp,
        tangent: Math.atan2(tangentY, tangentX),
        tangentX,
        tangentY,
        tangentLength: Math.hypot(tangentX, tangentY)
      };
    }

    const measure = () => {
      const panelStyle = getComputedStyle(startPanel);
      const centerX = parseFloat(panelStyle.left);
      const centerY = parseFloat(panelStyle.top);
      const galleryWidth = gallery.clientWidth;
      const galleryHeight = gallery.clientHeight;

      orbits.forEach((orbit) => {
        const majorRadius = orbit.panelMajor
          ? startPanel.offsetWidth * orbit.panelMajor
          : Math.min(
              galleryWidth * orbit.majorWidth,
              galleryHeight * orbit.majorHeight
            );
        const minorRadius = orbit.panelMinor
          ? startPanel.offsetHeight * orbit.panelMinor
          : Math.min(
              galleryWidth * orbit.minorWidth,
              galleryHeight * orbit.minorHeight
            );
        const frameHeight = Math.max(
          orbit.layer === "outer" ? 76 : 46,
          Math.min(
            orbit.layer === "outer" ? 124 : 70,
            galleryHeight * orbit.frameHeight
          )
        );
        const orbitAngle = orbit.angle * Math.PI / 180;
        const previousProgress = orbit.geometry && orbit.geometry.totalLength
          ? orbit.distance / orbit.geometry.totalLength
          : orbit.initialProgress;
        const geometry = buildArcLengthGeometry(majorRadius, minorRadius, orbitAngle, orbit.depth);

        orbit.frames = [...orbit.ring.querySelectorAll(".film-frame")];
        orbit.ring.style.setProperty("--film-height", `${frameHeight}px`);
        const frameStyle = getComputedStyle(orbit.frames[0]);
        const verticalInset =
          parseFloat(frameStyle.paddingTop) +
          parseFloat(frameStyle.paddingBottom) +
          parseFloat(frameStyle.borderTopWidth) +
          parseFloat(frameStyle.borderBottomWidth);
        const horizontalInset =
          parseFloat(frameStyle.paddingLeft) +
          parseFloat(frameStyle.paddingRight) +
          parseFloat(frameStyle.borderLeftWidth) +
          parseFloat(frameStyle.borderRightWidth);
        const ratioTotal = orbit.frames.reduce(
          (sum, frame) => sum + Number(frame.dataset.ratio || 4 / 3),
          0
        );
        const fittedFrameHeight = Math.max(
          verticalInset + 12,
          (geometry.totalLength - horizontalInset * orbit.frames.length) / ratioTotal +
            verticalInset
        );
        const photoHeight = fittedFrameHeight - verticalInset;
        let stripOffset = 0;

        orbit.frames.forEach((frame) => {
          const ratio = Number(frame.dataset.ratio || 4 / 3);
          const width = photoHeight * ratio + horizontalInset;
          frame._filmWidth = width;
          frame._filmOffset = stripOffset + width / 2;
          frame.style.setProperty("--frame-width", `${width}px`);
          stripOffset += width;
        });
        orbit.geometry = geometry;
        orbit.distance = previousProgress * geometry.totalLength;
        orbit.stripScale = geometry.totalLength / stripOffset;
        orbit.stage.style.left = `${centerX}px`;
        orbit.stage.style.top = `${centerY}px`;
        orbit.stage.style.setProperty("--orbit-width", `${majorRadius * 2}px`);
        orbit.stage.style.setProperty("--orbit-height", `${minorRadius * 2}px`);
        orbit.stage.style.setProperty("--orbit-angle", `${orbit.angle}deg`);
        orbit.stage.dataset.majorRadius = String(majorRadius);
        orbit.stage.dataset.minorRadius = String(minorRadius);
        orbit.stage.dataset.centerX = String(centerX);
        orbit.stage.dataset.centerY = String(centerY);
        orbit.ring.style.setProperty("--film-height", `${fittedFrameHeight}px`);
      });
      gallery.dataset.filmReady = "true";
    };

    const render = (now) => {
      if (orbits.some((orbit) => !orbit.geometry)) measure();
      if (lastFrameTime === null) lastFrameTime = now;
      const deltaSeconds = Math.min(0.05, Math.max(0, now - lastFrameTime) / 1000);
      lastFrameTime = now;

      orbits.forEach((orbit) => {
        const { geometry, frames } = orbit;
        if (!reducedMotion) {
          orbit.distance = wrap(
            orbit.distance + orbit.speed * orbit.direction * deltaSeconds,
            geometry.totalLength
          );
        }

        frames.forEach((frame) => {
          const frameWidth = frame._filmWidth * orbit.stripScale;
          const distance = orbit.distance + frame._filmOffset * orbit.stripScale;
          const point = samplePath(geometry, distance);
          const edgeStart = samplePath(geometry, distance - frameWidth * .56);
          const edgeEnd = samplePath(geometry, distance + frameWidth * .56);
          const chord = Math.hypot(edgeEnd.x - edgeStart.x, edgeEnd.y - edgeStart.y);
          const axisDirection = point.tangentX >= 0 ? 1 : -1;
          const axisAngle = Math.atan2(
            point.tangentY * axisDirection,
            point.tangentX * axisDirection
          );
          // Project the ribbon's cross-section against the camera. It reaches
          // zero at the two side-on points, then changes sign as the back face
          // turns into the front face. Pairing that sign change with the
          // directionless axis keeps the strip continuous without rotating the
          // photos upside down.
          const twist = -point.tangentX / point.tangentLength;
          // Depth comes from where the frame sits on the receding plane, not
          // from how the ribbon faces: the near (bottom) arc is large, bright
          // and in front; the far (top) arc shrinks, dims and recedes behind
          // the panel. This is what gives the loop real spatial depth.
          const near = point.near;
          const depthEase = near * near * (3 - 2 * near);
          const widthScale = chord / frame._filmWidth;
          const heightScale = (.58 + depthEase * .62) * twist;
          const axisDegrees = axisAngle * 180 / Math.PI;
          const frontFacing = twist >= 0;
          const zIndex = near >= .5 ? orbit.zFront : orbit.zBack;

          if (frame._filmZ !== zIndex) {
            frame.style.zIndex = String(zIndex);
            frame._filmZ = zIndex;
          }
          if (frame._filmFront !== frontFacing) {
            frame.classList.toggle("film-back", !frontFacing);
            frame.style.setProperty("--photo-flip", frontFacing ? "1" : "-1");
            frame._filmFront = frontFacing;
          }
          frame._filmAxisAngle = axisDegrees;
          frame._filmTwist = twist;
          frame.style.opacity = String(.34 + depthEase * .66);
          frame.style.transform =
            `translate3d(${point.x}px, ${point.y}px, 0) rotate(${axisDegrees}deg) ` +
            `scaleX(${widthScale}) scaleY(${heightScale})`;
        });
      });
      if (!reducedMotion) animationId = window.requestAnimationFrame(render);
    };

    measure();
    render(performance.now());

    const handleResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        const progress = orbits.map((orbit) =>
          orbit.geometry ? orbit.distance / orbit.geometry.totalLength : orbit.initialProgress
        );
        orbits.forEach((orbit, index) => {
          orbit.initialProgress = progress[index];
          orbit.geometry = null;
        });
        if (reducedMotion) render(performance.now());
      });
    };
    const handleVisibility = () => {
      lastFrameTime = null;
    };

    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(gallery);
      resizeObserver.observe(startPanel);
    } else {
      window.addEventListener("resize", handleResize);
    }
    document.addEventListener("visibilitychange", handleVisibility);
    addCleanup(() => {
      gallery.dataset.filmReady = "false";
      window.cancelAnimationFrame(animationId);
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibility);
      orbits.forEach((orbit) => {
        delete orbit.stage.dataset.majorRadius;
        delete orbit.stage.dataset.minorRadius;
        delete orbit.stage.dataset.centerX;
        delete orbit.stage.dataset.centerY;
        orbit.frames?.forEach((frame) => {
          delete frame._filmZ;
          delete frame._filmFront;
          delete frame._filmAxisAngle;
          delete frame._filmTwist;
          delete frame._filmWidth;
          delete frame._filmOffset;
        });
      });
    });
  }

  function enterStart() {
    const outerRing = document.querySelector("#film-ring");
    const innerRing = document.querySelector("#film-ring-inner");
    const prepareGallery = async () => {
      if (outerRing && innerRing && outerRing.dataset.built !== "true") {
        const photos = await discoverPhotos();
        await buildFilmGallery(photos);
        outerRing.dataset.built = "true";
        innerRing.dataset.built = "true";
      }
      if (activeScene === "start") startFilmOrbit();
    };
    prepareGallery();
    if (state.finalCompleted) {
      stopHomeSong();
    } else {
      setHomeSongVolume(HOME_SONG_FOREGROUND_VOLUME);
      later(() => {
        playHomeSong(HOME_SONG_FOREGROUND_VOLUME);
      }, 80);
    }
    listen(document.querySelector("#scene-start"), "pointerdown", () => {
      if (homeSong?.paused) playHomeSong(HOME_SONG_FOREGROUND_VOLUME);
    }, { once: true });
    const startButton = document.querySelector("#start-button");
    const handleStart = () => {
      audio.init();
      audio.click();
      if (!state.finalCompleted) {
        if (homeSong?.paused) {
          playHomeSong(HOME_SONG_BACKGROUND_VOLUME);
        } else {
          setHomeSongVolume(HOME_SONG_BACKGROUND_VOLUME, 700);
        }
      }
      playStartTransition(state.finalCompleted ? "final" : "hub", {
        revealCompleted: state.finalCompleted
      });
    };
    listen(startButton, "pointerup", handleStart);
  }

  function enterHub(options = {}) {
    updateHub();
    const gate = document.querySelector("#summon-gate");
    const syncGateCircle = () => {
      let centerX = 0;
      let centerY = 0;
      let node = gate;
      while (node && node !== shell) {
        centerX += node.offsetLeft;
        centerY += node.offsetTop;
        node = node.offsetParent;
      }
      window.magic?.setCircle(centerX, centerY);
    };
    syncGateCircle();
    let gateResizeObserver = null;
    if ("ResizeObserver" in window) {
      gateResizeObserver = new ResizeObserver(syncGateCircle);
      gateResizeObserver.observe(gate);
      gateResizeObserver.observe(shell);
      addCleanup(() => gateResizeObserver.disconnect());
    } else {
      window.addEventListener("resize", syncGateCircle);
      addCleanup(() => window.removeEventListener("resize", syncGateCircle));
    }
    document.querySelectorAll(".hub-entry").forEach((entry) => {
      const handler = () => {
        if (transitionLocked) return;
        audio.click();
        showScene(entry.dataset.game);
      };
      listen(entry, "pointerup", handler);
    });

    listen(gate, "pointerup", () => {
      if (!state.finalUnlocked) {
        audio.bump();
        showHubToast(`还差 ${GAME_KEYS.length - countCompleted()} 份礼物能量，法阵暂时没有回应。`);
        return;
      }
      audio.collect();
      showScene("final");
    });

    if (options.justCompleted) {
      later(() => {
        showHubToast(`${REWARDS[options.justCompleted].title}的礼物能量已点亮！`);
      }, 250);
    } else if (state.finalUnlocked && !state.finalCompleted) {
      later(() => showHubToast("五份能量已集齐，中央礼物召唤阵已解锁！"), 350);
    }
  }

  function updateHub() {
    const completedCount = countCompleted();
    document.querySelector("#hub-progress").textContent = `${completedCount} / ${GAME_KEYS.length}`;
    window.magic?.setCharge(completedCount / GAME_KEYS.length);
    const room = document.querySelector("#hub-room");
    room.dataset.power = String(completedCount);

    document.querySelectorAll(".hub-entry").forEach((entry) => {
      const completed = state.completed[entry.dataset.game];
      entry.classList.toggle("completed", completed);
      entry.querySelector(".entry-status").textContent = completed ? "已点亮 · 可重玩" : "未点亮";
      entry.setAttribute(
        "aria-label",
        completed
          ? `${REWARDS[entry.dataset.game].title}已解锁，点击重玩${entry.querySelector("strong").textContent}`
          : `进入${entry.querySelector("strong").textContent}，礼物尚未揭晓`
      );
    });

    const gate = document.querySelector("#summon-gate");
    gate.classList.toggle("locked", !state.finalUnlocked);
    gate.classList.toggle("unlocked", state.finalUnlocked);
    gate.setAttribute(
      "aria-label",
      state.finalUnlocked ? "中央礼物召唤阵，已解锁" : "中央礼物召唤阵，尚未解锁"
    );
    document.querySelector("#gate-label").textContent = state.finalUnlocked ? "召唤阵已解锁" : "能量未集齐";
    document.querySelector("#gate-hint").textContent = state.finalUnlocked
      ? "点击进入终极礼物召唤"
      : "还需要收集全部礼物能量";
  }

  function showHubToast(text) {
    const toast = document.querySelector("#hub-toast");
    toast.textContent = text;
    toast.classList.remove("show");
    void toast.offsetWidth;
    toast.classList.add("show");
  }

  function enterStella() {
    const scene = document.querySelector("#scene-stella");
    const field = document.querySelector("#star-field");
    const touchStrip = scene.querySelector(".touch-strip");
    const basket = document.querySelector("#basket");
    const scoreNode = document.querySelector("#star-score");
    const message = document.querySelector("#stella-message");
    let score = 0;
    let basketCenter = field.clientWidth / 2;
    let dragging = false;
    let running = true;
    let lastTime = performance.now();
    let spawnAccumulator = 500;
    let animationId = 0;
    const items = new Set();

    scoreNode.textContent = "0 / 6";
    field.querySelectorAll(".falling-item, .star-burst").forEach((node) => node.remove());

    const moveBasket = (clientX) => {
      const rect = field.getBoundingClientRect();
      const basketWidth = basket.offsetWidth;
      const localX = (clientX - rect.left) / shellScale;
      basketCenter = Math.max(
        basketWidth / 2 + 10,
        Math.min(localX, field.offsetWidth - basketWidth / 2 - 10)
      );
      basket.style.left = `${basketCenter}px`;
    };

    [field, touchStrip].forEach((target) => {
      listen(target, "pointerdown", (event) => {
        dragging = true;
        target.setPointerCapture?.(event.pointerId);
        moveBasket(event.clientX);
      });
      listen(target, "pointermove", (event) => {
        if (!dragging) return;
        event.preventDefault();
        moveBasket(event.clientX);
      }, { passive: false });
      listen(target, "pointerup", () => {
        dragging = false;
      });
      listen(target, "pointercancel", () => {
        dragging = false;
      });
    });

    function spawnItem() {
      if (!running) return;
      const isBomb = Math.random() < 0.2;
      const node = document.createElement("span");
      node.className = `falling-item ${isBomb ? "bomb" : "star"}`;
      const glyph = document.createElement("span");
      glyph.textContent = isBomb ? "×" : "★";
      node.appendChild(glyph);
      const size = Math.max(42, field.clientWidth * 0.04);
      const item = {
        node,
        type: isBomb ? "bomb" : "star",
        x: 24 + Math.random() * Math.max(40, field.clientWidth - size - 48),
        y: -size,
        speed: 105 + Math.random() * 55,
        size
      };
      node.style.left = `${item.x}px`;
      node.style.top = "0";
      field.appendChild(node);
      items.add(item);
    }

    function removeItem(item) {
      item.node.remove();
      items.delete(item);
    }

    function handleCatch(item) {
      window.magic?.burstEl(basket, item.type === "star" ? "starCaught" : "fizzle");
      if (item.type === "star") {
        score += 1;
        scoreNode.textContent = `${score} / 6`;
        audio.collect();
        if (score >= 6) {
          running = false;
          completeGame("stella", "星光汇聚完成！", message);
        }
      } else {
        score = Math.max(0, score - 1);
        scoreNode.textContent = `${score} / 6`;
        audio.bump();
        field.classList.remove("screen-bump");
        void field.offsetWidth;
        field.classList.add("screen-bump");
      }
      removeItem(item);
    }

    function frame(now) {
      if (!running) return;
      const delta = Math.min(0.035, (now - lastTime) / 1000);
      lastTime = now;
      spawnAccumulator += delta * 1000;
      if (spawnAccumulator >= 690) {
        spawnAccumulator = 0;
        spawnItem();
      }

      const basketRect = {
        left: basketCenter - basket.offsetWidth / 2,
        right: basketCenter + basket.offsetWidth / 2,
        top: field.clientHeight - basket.offsetHeight - field.clientHeight * 0.05
      };

      [...items].forEach((item) => {
        item.y += item.speed * delta;
        item.node.style.transform = `translate3d(0, ${item.y}px, 0)`;
        const itemBottom = item.y + item.size;
        const overlapsBasket =
          itemBottom >= basketRect.top &&
          item.y <= basketRect.top + basket.offsetHeight * 0.75 &&
          item.x + item.size >= basketRect.left &&
          item.x <= basketRect.right;

        if (overlapsBasket) {
          handleCatch(item);
        } else if (item.y > field.clientHeight + item.size) {
          removeItem(item);
        }
      });

      animationId = requestAnimationFrame(frame);
    }

    spawnItem();
    animationId = requestAnimationFrame(frame);
    addCleanup(() => {
      running = false;
      cancelAnimationFrame(animationId);
      items.forEach((item) => item.node.remove());
      items.clear();
      field.classList.remove("screen-bump");
      basket.style.left = "50%";
    });
  }

  const DOG_LEVELS = [
    {
      shots: 3,
      blocks: [
        { x: .79, y: .835, w: .28, h: .05, material: "stone" },
        { x: .72, y: .715, w: .038, h: .23, material: "wood" },
        { x: .86, y: .715, w: .038, h: .23, material: "wood" },
        { x: .79, y: .585, w: .21, h: .05, material: "wood" }
      ],
      cats: [{ x: .79, y: .515, size: .105 }]
    },
    {
      shots: 4,
      blocks: [
        { x: .69, y: .835, w: .23, h: .05, material: "stone" },
        { x: .64, y: .735, w: .032, h: .18, material: "glass" },
        { x: .74, y: .735, w: .032, h: .18, material: "glass" },
        { x: .69, y: .625, w: .16, h: .045, material: "wood" },
        { x: .86, y: .835, w: .18, h: .05, material: "stone" },
        { x: .82, y: .765, w: .034, h: .12, material: "wood" },
        { x: .9, y: .765, w: .034, h: .12, material: "wood" },
        { x: .86, y: .685, w: .13, h: .045, material: "glass" }
      ],
      cats: [
        { x: .69, y: .56, size: .1 },
        { x: .86, y: .625, size: .095 }
      ]
    },
    {
      shots: 5,
      blocks: [
        { x: .64, y: .835, w: .18, h: .05, material: "stone" },
        { x: .6, y: .765, w: .03, h: .12, material: "glass" },
        { x: .68, y: .765, w: .03, h: .12, material: "glass" },
        { x: .64, y: .685, w: .13, h: .045, material: "wood" },
        { x: .79, y: .835, w: .2, h: .05, material: "wood" },
        { x: .745, y: .69, w: .034, h: .27, material: "wood" },
        { x: .835, y: .69, w: .034, h: .27, material: "wood" },
        { x: .79, y: .54, w: .15, h: .05, material: "stone" },
        { x: .92, y: .835, w: .14, h: .05, material: "stone" },
        { x: .89, y: .77, w: .028, h: .11, material: "glass" },
        { x: .95, y: .77, w: .028, h: .11, material: "glass" },
        { x: .92, y: .7, w: .1, h: .04, material: "wood" }
      ],
      cats: [
        { x: .64, y: .625, size: .095 },
        { x: .79, y: .47, size: .1 },
        { x: .92, y: .645, size: .09 }
      ]
    }
  ];

  function enterDog() {
    const battle = document.querySelector("#dog-battle");
    const projectile = document.querySelector("#dog-projectile");
    const fort = document.querySelector("#cat-fort");
    const dots = document.querySelector("#trajectory-dots");
    const slingshot = document.querySelector(".slingshot");
    const bandBack = document.querySelector("#sling-band-back");
    const bandFront = document.querySelector("#sling-band-front");
    const ammoRack = document.querySelector("#dog-ammo");
    const ammoCount = document.querySelector("#dog-ammo-count");
    const levelBanner = document.querySelector("#dog-level-banner");
    const tip = document.querySelector("#dog-battle-tip");
    const levelScore = document.querySelector("#dog-level-score");
    const catCount = document.querySelector("#cat-count");
    const message = document.querySelector("#dog-message");
    const MATERIALS = {
      glass: { health: 95, mass: .65, restitution: .26 },
      wood: { health: 175, mass: 1, restitution: .18 },
      stone: { health: 360, mass: 2.1, restitution: .1 }
    };
    const GRAVITY = 790;
    const POWER = 6.15;
    const FIXED_STEP = 1 / 120;
    let levelIndex = 0;
    let shotsRemaining = 0;
    let catsRemaining = 0;
    let bodies = [];
    let origin = { x: 0, y: 0 };
    let readyPosition = { x: 0, y: 0 };
    let projectilePosition = { x: 0, y: 0 };
    let projectileVelocity = { x: 0, y: 0 };
    let projectileRadius = 32;
    let projectileState = "loading";
    let dragPointerId = null;
    let dragStartClient = { x: 0, y: 0 };
    let animationId = 0;
    let lastFrameTime = 0;
    let accumulator = 0;
    let flightTime = 0;
    let quietTime = 0;
    let groundBounces = 0;
    let finishQueued = false;
    let completed = false;
    let resizeObserver = null;
    const collisionTimes = new WeakMap();

    function setBand(band, anchorX, anchorY, targetX, targetY) {
      const dx = targetX - anchorX;
      const dy = targetY - anchorY;
      band.style.left = `${anchorX}px`;
      band.style.top = `${anchorY}px`;
      band.style.width = `${Math.hypot(dx, dy)}px`;
      band.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    }

    function updateSlingBands(targetX = projectilePosition.x, targetY = projectilePosition.y) {
      const fork = Math.max(19, battle.clientWidth * .018);
      setBand(bandBack, origin.x - fork, origin.y - 10, targetX, targetY);
      setBand(bandFront, origin.x + fork, origin.y - 10, targetX, targetY);
    }

    function setBandsVisible(visible) {
      bandBack.style.opacity = visible ? ".82" : "0";
      bandFront.style.opacity = visible ? "1" : "0";
    }

    function placeProjectile(x, y) {
      projectilePosition = { x, y };
      projectile.style.transform =
        `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      if (projectileState === "ready" || projectileState === "dragging") {
        updateSlingBands(x, y);
      }
    }

    function updateAmmo() {
      ammoCount.textContent = String(shotsRemaining);
      ammoRack.replaceChildren();
      for (let index = 1; index < shotsRemaining; index += 1) {
        const icon = document.createElement("span");
        icon.innerHTML = '<img src="catDog/dog.png" alt="" draggable="false">';
        ammoRack.appendChild(icon);
      }
    }

    function bodySupported(body) {
      if (body.removed) return false;
      const groundY = battle.clientHeight * .86;
      const bottom = body.y + body.h / 2;
      if (bottom >= groundY - 5) return true;
      return bodies.some((support) => {
        if (support === body || support.removed) return false;
        const horizontalOverlap =
          Math.min(body.x + body.w * .38, support.x + support.w / 2) -
          Math.max(body.x - body.w * .38, support.x - support.w / 2);
        const supportTop = support.y - support.h / 2;
        return horizontalOverlap > Math.min(body.w, support.w) * .16 &&
          bottom >= supportTop - 7 &&
          bottom <= supportTop + 11;
      });
    }

    function renderBody(body) {
      body.node.style.left = `${body.x}px`;
      body.node.style.top = `${body.y}px`;
      body.node.style.transform =
        `translate(-50%, -50%) rotate(${body.angle}deg)`;
    }

    function createDebris(body) {
      const colors = {
        glass: ["#d9ffff", "#75cdd6"],
        wood: ["#f4bd68", "#9b5538"],
        stone: ["#d8c5ca", "#775665"]
      }[body.material] || ["#fff0ae", "#a85f78"];
      for (let index = 0; index < 8; index += 1) {
        const debris = document.createElement("i");
        debris.className = "fort-debris";
        debris.style.left = `${body.x}px`;
        debris.style.top = `${body.y}px`;
        debris.style.background = colors[index % colors.length];
        debris.style.setProperty("--debris-x", `${(Math.random() - .5) * 150}px`);
        debris.style.setProperty("--debris-y", `${35 + Math.random() * 100}px`);
        battle.appendChild(debris);
        window.setTimeout(() => debris.remove(), 760);
      }
    }

    function shakeBattle() {
      battle.classList.remove("fort-impact");
      void battle.offsetWidth;
      battle.classList.add("fort-impact");
    }

    function breakBlock(body) {
      if (body.removed) return;
      body.removed = true;
      body.node.classList.add("block-hit");
      createDebris(body);
      later(() => body.node.remove(), 430);
      shakeBattle();
      audio.bump();
    }

    function defeatCat(body) {
      if (body.removed) return;
      body.removed = true;
      body.node.classList.add("cat-hit");
      catsRemaining = Math.max(0, catsRemaining - 1);
      catCount.textContent = String(catsRemaining);
      window.magic?.burstEl(body.node, "catDefeated");
      later(() => body.node.remove(), 650);
      audio.collect();
    }

    function damageBlock(body, force) {
      if (body.removed || force < 70) return;
      body.health -= force;
      body.node.classList.remove("block-damaged");
      void body.node.offsetWidth;
      body.node.classList.add("block-damaged");
      if (body.health <= 0) breakBlock(body);
    }

    function wakeBody(body, impulseX = 0, impulseY = 0) {
      if (body.removed) return;
      body.sleeping = false;
      body.vx += impulseX / body.mass;
      body.vy += impulseY / body.mass;
      body.spin += (impulseX >= 0 ? 1 : -1) *
        Math.min(180, Math.abs(impulseX) * .12);
      body.node.classList.add("body-moving");
    }

    function wakeUnsupportedBodies() {
      bodies.forEach((body) => {
        if (!body.removed && body.sleeping && !bodySupported(body)) {
          wakeBody(body);
        }
      });
    }

    function overlapBodies(first, second) {
      const overlapX =
        Math.min(first.x + first.w / 2, second.x + second.w / 2) -
        Math.max(first.x - first.w / 2, second.x - second.w / 2);
      const overlapY =
        Math.min(first.y + first.h / 2, second.y + second.h / 2) -
        Math.max(first.y - first.h / 2, second.y - second.h / 2);
      return overlapX > 0 && overlapY > 0 ? { overlapX, overlapY } : null;
    }

    function resolveBodyPair(first, second) {
      if (first.removed || second.removed || (first.sleeping && second.sleeping)) return;
      const overlap = overlapBodies(first, second);
      if (!overlap) return;
      let normalX = 0;
      let normalY = 0;
      let penetration = 0;
      if (overlap.overlapX < overlap.overlapY) {
        normalX = first.x < second.x ? -1 : 1;
        penetration = overlap.overlapX;
      } else {
        normalY = first.y < second.y ? -1 : 1;
        penetration = overlap.overlapY;
      }
      const firstDynamic = !first.sleeping;
      const secondDynamic = !second.sleeping;
      const share = firstDynamic && secondDynamic ? .5 : 1;
      if (firstDynamic) {
        first.x += normalX * penetration * share;
        first.y += normalY * penetration * share;
      }
      if (secondDynamic) {
        second.x -= normalX * penetration * share;
        second.y -= normalY * penetration * share;
      }
      const relativeX = first.vx - second.vx;
      const relativeY = first.vy - second.vy;
      const closing = relativeX * normalX + relativeY * normalY;
      if (closing >= 0) return;
      const impact = Math.abs(closing);
      const impulse = impact * .32;
      if (firstDynamic) {
        first.vx -= normalX * impulse;
        first.vy -= normalY * impulse;
      }
      if (secondDynamic) {
        second.vx += normalX * impulse;
        second.vy += normalY * impulse;
      }
      if (impact > 145) {
        if (first.kind === "cat" && second.kind === "block") defeatCat(first);
        if (second.kind === "cat" && first.kind === "block") defeatCat(second);
        if (first.kind === "block") damageBlock(first, impact * .22);
        if (second.kind === "block") damageBlock(second, impact * .22);
      }
    }

    function updateBodies(step) {
      const groundY = battle.clientHeight * .86;
      let moving = false;
      wakeUnsupportedBodies();
      bodies.forEach((body) => {
        if (body.removed || body.sleeping) return;
        moving = true;
        body.vy += GRAVITY * step;
        body.x += body.vx * step;
        body.y += body.vy * step;
        body.angle += body.spin * step;
        body.vx *= Math.pow(.992, step * 60);
        body.spin *= Math.pow(.985, step * 60);
        const bottom = body.y + body.h / 2;
        if (bottom >= groundY) {
          const impact = Math.abs(body.vy);
          body.y = groundY - body.h / 2;
          body.vy = -body.vy * .16;
          body.vx *= .7;
          body.spin *= .64;
          if (body.kind === "cat" && (impact > 165 || body.maxFall > body.h * .42)) {
            defeatCat(body);
            return;
          }
          if (body.kind === "block") damageBlock(body, Math.max(0, impact - 110) * .2);
        }
        body.maxFall = Math.max(body.maxFall, body.y - body.startY);
      });

      for (let pass = 0; pass < 3; pass += 1) {
        for (let firstIndex = 0; firstIndex < bodies.length; firstIndex += 1) {
          for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex += 1) {
            resolveBodyPair(bodies[firstIndex], bodies[secondIndex]);
          }
        }
      }

      bodies.forEach((body) => {
        if (body.removed || body.sleeping) return;
        if (
          body.x < -120 ||
          body.x > battle.clientWidth + 120 ||
          body.y > battle.clientHeight + 120
        ) {
          if (body.kind === "cat") defeatCat(body);
          else breakBlock(body);
          return;
        }
        const speed = Math.hypot(body.vx, body.vy);
        if (speed < 24 && Math.abs(body.spin) < 22 && bodySupported(body)) {
          body.restTime += step;
          if (body.restTime > .32) {
            body.sleeping = true;
            body.vx = 0;
            body.vy = 0;
            body.spin = 0;
            body.node.classList.remove("body-moving");
          }
        } else {
          body.restTime = 0;
        }
        renderBody(body);
      });
      return moving;
    }

    function projectileBlockCollision(body) {
      const left = body.x - body.w / 2;
      const right = body.x + body.w / 2;
      const top = body.y - body.h / 2;
      const bottom = body.y + body.h / 2;
      const nearestX = Math.max(left, Math.min(projectilePosition.x, right));
      const nearestY = Math.max(top, Math.min(projectilePosition.y, bottom));
      let dx = projectilePosition.x - nearestX;
      let dy = projectilePosition.y - nearestY;
      let distance = Math.hypot(dx, dy);
      if (distance >= projectileRadius) return false;
      if (distance < .001) {
        const distances = [
          { x: -1, y: 0, value: Math.abs(projectilePosition.x - left) },
          { x: 1, y: 0, value: Math.abs(right - projectilePosition.x) },
          { x: 0, y: -1, value: Math.abs(projectilePosition.y - top) },
          { x: 0, y: 1, value: Math.abs(bottom - projectilePosition.y) }
        ].sort((a, b) => a.value - b.value);
        dx = distances[0].x;
        dy = distances[0].y;
        distance = 1;
      }
      const normalX = dx / distance;
      const normalY = dy / distance;
      const penetration = projectileRadius - distance;
      projectilePosition.x += normalX * penetration;
      projectilePosition.y += normalY * penetration;
      const normalSpeed =
        projectileVelocity.x * normalX + projectileVelocity.y * normalY;
      if (normalSpeed >= 0) return true;
      const impact = Math.abs(normalSpeed);
      const now = performance.now();
      const lastCollision = collisionTimes.get(body) || 0;
      if (now - lastCollision > 90) {
        collisionTimes.set(body, now);
        damageBlock(body, impact * .44);
        wakeBody(
          body,
          -normalX * impact * body.mass * .72,
          -normalY * impact * body.mass * .72
        );
        shakeBattle();
        audio.bump();
      }
      const restitution = MATERIALS[body.material].restitution;
      projectileVelocity.x -= (1 + restitution) * normalSpeed * normalX;
      projectileVelocity.y -= (1 + restitution) * normalSpeed * normalY;
      projectileVelocity.x *= .84;
      projectileVelocity.y *= .84;
      return true;
    }

    function projectileCatCollision(body) {
      const radius = body.w * .43;
      const dx = projectilePosition.x - body.x;
      const dy = projectilePosition.y - body.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= projectileRadius + radius) return false;
      const speed = Math.hypot(projectileVelocity.x, projectileVelocity.y);
      if (speed > 105) defeatCat(body);
      const normalX = distance > 0 ? dx / distance : -1;
      const normalY = distance > 0 ? dy / distance : 0;
      projectilePosition.x = body.x + normalX * (projectileRadius + radius);
      projectilePosition.y = body.y + normalY * (projectileRadius + radius);
      projectileVelocity.x *= .72;
      projectileVelocity.y *= .72;
      shakeBattle();
      return true;
    }

    function updateProjectile(step) {
      if (projectileState !== "flying") return;
      flightTime += step;
      projectileVelocity.y += GRAVITY * step;
      projectilePosition.x += projectileVelocity.x * step;
      projectilePosition.y += projectileVelocity.y * step;
      bodies.forEach((body) => {
        if (body.removed) return;
        if (body.kind === "cat") projectileCatCollision(body);
        else projectileBlockCollision(body);
      });
      const groundY = battle.clientHeight * .86 - projectileRadius;
      if (projectilePosition.y >= groundY && projectileVelocity.y > 0) {
        projectilePosition.y = groundY;
        projectileVelocity.y *= -.32;
        projectileVelocity.x *= .68;
        groundBounces += 1;
        audio.bump();
      }
      placeProjectile(projectilePosition.x, projectilePosition.y);
      const speed = Math.hypot(projectileVelocity.x, projectileVelocity.y);
      if (
        projectilePosition.x > battle.clientWidth + 100 ||
        projectilePosition.x < -100 ||
        flightTime > 6 ||
        groundBounces > 3 ||
        (groundBounces > 0 && speed < 75)
      ) {
        projectileState = "settling";
        projectile.classList.remove("flying");
        projectile.classList.add("spent");
        quietTime = 0;
      }
    }

    function finishLevel() {
      if (finishQueued || completed) return;
      finishQueued = true;
      battle.dataset.ready = "false";
      projectile.disabled = true;
      if (levelIndex === DOG_LEVELS.length - 1) {
        completed = true;
        showLevelMessage(message, "黑猫全部击退！");
        later(() => completeGame("dog", "三关完成！", message), 650);
        return;
      }
      showLevelMessage(message, `第 ${levelIndex + 1} 关通过！`);
      later(() => {
        levelIndex += 1;
        renderLevel();
      }, 950);
    }

    function resolveShot() {
      if (catsRemaining <= 0) {
        finishLevel();
        return;
      }
      if (shotsRemaining <= 0) {
        tip.textContent = "小狗用完了，正在重新搭建堡垒";
        showLevelMessage(message, "再试一次！");
        later(renderLevel, 1000);
        return;
      }
      tip.textContent = `还剩 ${catsRemaining} 只黑猫，优先打断承重结构`;
      later(loadProjectile, 300);
    }

    function frame(now) {
      if (completed || finishQueued) return;
      if (!lastFrameTime) lastFrameTime = now;
      accumulator += Math.min(.04, (now - lastFrameTime) / 1000);
      lastFrameTime = now;
      let bodiesMoving = false;
      while (accumulator >= FIXED_STEP) {
        updateProjectile(FIXED_STEP);
        bodiesMoving = updateBodies(FIXED_STEP) || bodiesMoving;
        accumulator -= FIXED_STEP;
      }
      if (catsRemaining <= 0) {
        finishLevel();
        return;
      }
      if (projectileState === "settling") {
        if (bodiesMoving) quietTime = 0;
        else quietTime += Math.min(.04, (now - lastFrameTime) / 1000);
        if (!bodiesMoving) quietTime += FIXED_STEP;
        if (quietTime > .45) {
          resolveShot();
          return;
        }
      }
      if (
        projectileState === "flying" ||
        projectileState === "settling" ||
        bodiesMoving
      ) {
        animationId = requestAnimationFrame(frame);
      }
    }

    function startLoop() {
      cancelAnimationFrame(animationId);
      lastFrameTime = performance.now();
      accumulator = 0;
      animationId = requestAnimationFrame(frame);
    }

    function loadProjectile() {
      projectileState = "ready";
      dragPointerId = null;
      flightTime = 0;
      quietTime = 0;
      groundBounces = 0;
      projectile.disabled = false;
      projectile.classList.remove("flying", "spent", "impact");
      battle.dataset.ready = "true";
      dots.classList.remove("show");
      dots.replaceChildren();
      placeProjectile(readyPosition.x, readyPosition.y);
      updateSlingBands(origin.x, origin.y);
      setBandsVisible(false);
    }

    function renderTrajectory() {
      dots.replaceChildren();
      const velocityX = (origin.x - projectilePosition.x) * POWER;
      const velocityY = (origin.y - projectilePosition.y) * POWER;
      for (let index = 1; index <= 14; index += 1) {
        const time = index * .105;
        const dot = document.createElement("i");
        dot.style.left = `${origin.x + velocityX * time}px`;
        dot.style.top =
          `${origin.y + velocityY * time + GRAVITY * time * time / 2}px`;
        dot.style.opacity = String(1 - index * .055);
        dots.appendChild(dot);
      }
    }

    function makeBlock(data, width, height) {
      const node = document.createElement("span");
      node.className = "fort-block";
      node.dataset.material = data.material;
      const material = MATERIALS[data.material];
      const body = {
        node,
        kind: "block",
        material: data.material,
        x: data.x * width,
        y: data.y * height,
        startY: data.y * height,
        w: data.w * width,
        h: data.h * height,
        mass: material.mass,
        health: material.health,
        vx: 0,
        vy: 0,
        angle: 0,
        spin: 0,
        maxFall: 0,
        restTime: 0,
        sleeping: true,
        removed: false
      };
      node.style.width = `${body.w}px`;
      node.style.height = `${body.h}px`;
      fort.appendChild(node);
      renderBody(body);
      return body;
    }

    function makeCat(data, width, height) {
      const node = document.createElement("span");
      node.className = "bad-cat";
      node.innerHTML =
        '<span class="cat-sprite"><img src="catDog/cat.png" alt="" draggable="false"></span>';
      const size = Math.max(48, Math.min(70, height * data.size));
      const body = {
        node,
        kind: "cat",
        material: "cat",
        x: data.x * width,
        y: data.y * height,
        startY: data.y * height,
        w: size,
        h: size * .91,
        mass: .72,
        health: 1,
        vx: 0,
        vy: 0,
        angle: 0,
        spin: 0,
        maxFall: 0,
        restTime: 0,
        sleeping: true,
        removed: false
      };
      node.style.width = `${size}px`;
      node.style.height = `${size * .91}px`;
      fort.appendChild(node);
      renderBody(body);
      return body;
    }

    function renderLevel() {
      cancelAnimationFrame(animationId);
      const level = DOG_LEVELS[levelIndex];
      const width = battle.clientWidth;
      const height = battle.clientHeight;
      finishQueued = false;
      projectileState = "loading";
      origin = { x: width * .155, y: height * .675 };
      readyPosition = {
        x: origin.x - Math.max(86, width * .075),
        y: origin.y + Math.max(52, height * .09)
      };
      projectileRadius = Math.max(29, Math.min(38, height * .068));
      projectile.style.width = `${projectileRadius * 2}px`;
      slingshot.style.left = `${origin.x}px`;
      slingshot.style.top = `${origin.y - 12}px`;
      fort.replaceChildren();
      battle.querySelectorAll(".fort-debris").forEach((node) => node.remove());
      bodies = [
        ...level.blocks.map((data) => makeBlock(data, width, height)),
        ...level.cats.map((data) => makeCat(data, width, height))
      ];
      shotsRemaining = level.shots;
      catsRemaining = level.cats.length;
      levelScore.textContent = `${levelIndex + 1} / ${DOG_LEVELS.length}`;
      catCount.textContent = String(catsRemaining);
      updateAmmo();
      tip.textContent = "向左后方拖动小狗，观察轨迹，松手发射";
      levelBanner.textContent = `LEVEL ${levelIndex + 1}`;
      levelBanner.classList.remove("show");
      void levelBanner.offsetWidth;
      levelBanner.classList.add("show");
      loadProjectile();
    }

    listen(projectile, "pointerdown", (event) => {
      if (projectileState !== "ready" || completed) return;
      projectileState = "dragging";
      dragPointerId = event.pointerId;
      dragStartClient = { x: event.clientX, y: event.clientY };
      projectile.setPointerCapture?.(event.pointerId);
      placeProjectile(origin.x, origin.y);
      setBandsVisible(true);
      dots.classList.add("show");
      window.magic?.setTrailEnabled(false);
    });

    listen(projectile, "pointermove", (event) => {
      if (projectileState !== "dragging" || event.pointerId !== dragPointerId) return;
      event.preventDefault();
      const rect = battle.getBoundingClientRect();
      const scaleX = battle.clientWidth / rect.width;
      const scaleY = battle.clientHeight / rect.height;
      const rawX = Math.min(
        origin.x + 4,
        origin.x + (event.clientX - dragStartClient.x) * scaleX
      );
      const rawY = origin.y + (event.clientY - dragStartClient.y) * scaleY;
      const dx = rawX - origin.x;
      const dy = rawY - origin.y;
      const maxPull = Math.min(165, battle.clientWidth * .145);
      const distance = Math.hypot(dx, dy) || 1;
      const ratio = Math.min(1, maxPull / distance);
      placeProjectile(origin.x + dx * ratio, origin.y + dy * ratio);
      renderTrajectory();
    }, { passive: false });

    function releaseProjectile() {
      if (projectileState !== "dragging") return;
      window.magic?.setTrailEnabled(true);
      dots.classList.remove("show");
      dots.replaceChildren();
      const pullX = origin.x - projectilePosition.x;
      const pullY = origin.y - projectilePosition.y;
      if (Math.hypot(pullX, pullY) < 24) {
        loadProjectile();
        return;
      }
      projectileState = "flying";
      shotsRemaining -= 1;
      updateAmmo();
      battle.dataset.ready = "false";
      projectile.disabled = true;
      projectile.classList.add("flying");
      projectileVelocity = {
        x: pullX * POWER,
        y: pullY * POWER
      };
      placeProjectile(origin.x, origin.y);
      updateSlingBands(origin.x, origin.y);
      setBandsVisible(false);
      audio.tone(420, .16, "square", .03);
      startLoop();
    }

    listen(projectile, "pointerup", releaseProjectile);
    listen(projectile, "pointercancel", () => {
      window.magic?.setTrailEnabled(true);
      loadProjectile();
    });

    const handleResize = () => {
      if (projectileState === "flying" || projectileState === "settling") return;
      renderLevel();
    };
    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(battle);
    }

    later(renderLevel, 40);
    addCleanup(() => {
      cancelAnimationFrame(animationId);
      resizeObserver?.disconnect();
      window.magic?.setTrailEnabled(true);
      fort.replaceChildren();
      dots.replaceChildren();
      battle.querySelectorAll(".fort-debris").forEach((node) => node.remove());
      battle.classList.remove("fort-impact");
      battle.dataset.ready = "false";
    });
  }

  const MATCH_ICONS = [
    { id: "kitty-face", label: "Hello Kitty", src: "assets/hello-kitty/kitty-face.png" },
    { id: "kitty-sitting", label: "坐着的 Hello Kitty", src: "assets/hello-kitty/kitty-sitting-badge.png" },
    { id: "kitty-bow", label: "Hello Kitty 蝴蝶结", src: "assets/hello-kitty/kitty-bow.png" },
    { id: "heart", label: "爱心", src: "assets/kenney/heart.png" },
    { id: "diamond", label: "钻石", src: "assets/kenney/diamond.png" },
    { id: "key", label: "钥匙", src: "assets/kenney/key.png" },
    { id: "coin", label: "金币", src: "assets/kenney/coin.png" },
    { id: "potion", label: "幸运药水", src: "assets/kenney/green-potion.png" }
  ];
  const MATCH_LEVELS = [
    { rows: 2, columns: 4, pairs: 4 },
    { rows: 3, columns: 4, pairs: 6 },
    { rows: 4, columns: 4, pairs: 8 }
  ];

  function enterHand() {
    const board = document.querySelector("#match-board");
    const levelScore = document.querySelector("#match-level-score");
    const pairsLeftNode = document.querySelector("#match-pairs-left");
    const tip = document.querySelector("#match-tip");
    const message = document.querySelector("#hand-message");
    let levelIndex = 0;
    let firstTile = null;
    let pairsLeft = 0;
    let locked = false;

    function shuffle(values) {
      const result = [...values];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
      }
      return result;
    }

    function renderLevel() {
      const level = MATCH_LEVELS[levelIndex];
      const icons = shuffle(MATCH_ICONS).slice(0, level.pairs);
      // Build the pairs, then shuffle every card so positions are unknown.
      const deck = shuffle(icons.flatMap((icon) => [icon, icon]));
      firstTile = null;
      locked = false;
      pairsLeft = level.pairs;
      board.replaceChildren();
      board.style.setProperty("--match-columns", String(level.columns));
      board.style.setProperty("--match-rows", String(level.rows));
      levelScore.textContent = `${levelIndex + 1} / 3`;
      pairsLeftNode.textContent = String(pairsLeft);
      tip.textContent = "翻开两张，找出相同的图案";

      deck.forEach((icon, index) => {
        const row = Math.floor(index / level.columns);
        const column = index % level.columns;
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "match-tile";
        tile.dataset.row = String(row);
        tile.dataset.column = String(column);
        tile.dataset.icon = icon.id;
        tile.innerHTML = `<img src="${icon.src}" alt="" draggable="false">`;
        tile.setAttribute("aria-label", "未翻开的卡片");
        board.appendChild(tile);
        listen(tile, "pointerup", () => selectTile(tile));
      });
    }

    function finishMatchLevel() {
      locked = true;
      if (levelIndex === MATCH_LEVELS.length - 1) {
        showLevelMessage(message, "治愈翻牌完成！");
        later(() => completeGame("hand", "三关完成！", message), 650);
        return;
      }
      showLevelMessage(message, `第 ${levelIndex + 1} 关完成！`);
      later(() => {
        levelIndex += 1;
        renderLevel();
      }, 1050);
    }

    function selectTile(tile) {
      if (locked) return;
      if (tile.classList.contains("matched") || tile.classList.contains("flipped")) return;
      audio.click();
      tile.classList.add("flipped");
      const icon = MATCH_ICONS.find((item) => item.id === tile.dataset.icon);
      tile.setAttribute("aria-label", `图案 ${icon?.label || tile.dataset.icon}`);

      if (!firstTile) {
        firstTile = tile;
        tip.textContent = "再翻开一张，看看是否相同";
        return;
      }

      const first = firstTile;
      const second = tile;
      locked = true;

      if (first.dataset.icon === second.dataset.icon) {
        audio.collect();
        window.magic?.burstEl(second, "matchFound");
        tip.textContent = "配对成功！";
        later(() => {
          first.classList.add("matched");
          second.classList.add("matched");
          pairsLeft -= 1;
          pairsLeftNode.textContent = String(pairsLeft);
          firstTile = null;
          locked = false;
          if (pairsLeft === 0) finishMatchLevel();
          else tip.textContent = "配对成功！继续翻牌";
        }, 280);
      } else {
        audio.bump();
        first.classList.add("mismatch");
        second.classList.add("mismatch");
        tip.textContent = "不一样，记住位置再翻回去";
        later(() => {
          first.classList.remove("flipped", "mismatch");
          second.classList.remove("flipped", "mismatch");
          first.setAttribute("aria-label", "未翻开的卡片");
          second.setAttribute("aria-label", "未翻开的卡片");
          firstTile = null;
          locked = false;
          tip.textContent = "翻开两张，找出相同的图案";
        }, 760);
      }
    }

    renderLevel();
  }

  const BLIND_LEVELS = [
    { count: 3, columns: 3, rows: 1, swaps: 10, speed: 460 },
    { count: 5, columns: 5, rows: 1, swaps: 14, speed: 360 },
    { count: 25, columns: 5, rows: 5, finalSpin: true }
  ];

  function enterBlind() {
    const board = document.querySelector("#blindbox-board");
    const prompt = document.querySelector("#blind-prompt");
    const levelScore = document.querySelector("#blind-level-score");
    const message = document.querySelector("#blind-message");
    let levelIndex = 0;
    let nodes = [];
    let canChoose = false;
    let completed = false;
    let failedAttempts = 0;

    function createConfetti(box) {
      const stage = document.querySelector(".blind-stage");
      const boxRect = box.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const colors = ["#ffe477", "#f68ba6", "#f5bad0", "#fff", "#d77aa2"];
      for (let index = 0; index < 30; index += 1) {
        const piece = document.createElement("i");
        piece.className = "confetti";
        piece.style.left = `${(boxRect.left - stageRect.left + boxRect.width / 2) / shellScale}px`;
        piece.style.top = `${(boxRect.top - stageRect.top + boxRect.height * 0.32) / shellScale}px`;
        piece.style.background = colors[index % colors.length];
        piece.style.setProperty("--confetti-x", `${(Math.random() - 0.5) * 440}px`);
        piece.style.setProperty("--confetti-y", `${80 + Math.random() * 230}px`);
        stage.appendChild(piece);
        window.setTimeout(() => piece.remove(), 1500);
      }
    }

    function gridPosition(node, slot) {
      const level = BLIND_LEVELS[levelIndex];
      const width = board.clientWidth;
      const height = board.clientHeight;
      const cellWidth = width / level.columns;
      const cellHeight = height / level.rows;
      const compact = level.count >= 25;
      const gap = compact ? 8 : level.count === 5 ? 14 : 24;
      const column = slot % level.columns;
      const row = Math.floor(slot / level.columns);
      const nodeWidth = Math.max(12, Math.min(cellWidth - gap, compact ? cellHeight * 1.05 : cellWidth));
      const nodeHeight = compact
        ? Math.max(12, cellHeight - gap)
        : Math.min(height * 0.82, nodeWidth * 1.18);
      return {
        width: nodeWidth,
        height: nodeHeight,
        x: column * cellWidth + (cellWidth - nodeWidth) / 2,
        y: row * cellHeight + (cellHeight - nodeHeight) / 2
      };
    }

    function applyPositions(animate = true, duration = null) {
      const level = BLIND_LEVELS[levelIndex];
      nodes.forEach(({ node, slot }) => {
        const position = gridPosition(node, slot);
        node.style.transitionDuration = animate
          ? `${duration ?? Math.max(35, level.speed || 120)}ms`
          : "0ms";
        node.style.width = `${position.width}px`;
        node.style.height = `${position.height}px`;
        node.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
      });
    }

    function orbitPosition(node, index, angleOffset) {
      const width = board.clientWidth;
      const height = board.clientHeight;
      const nodeWidth = node.offsetWidth;
      const nodeHeight = node.offsetHeight;
      let ringCount = 1;
      let ringIndex = 0;
      let radiusX = 0;
      let radiusY = 0;

      if (index > 0 && index <= 8) {
        ringCount = 8;
        ringIndex = index - 1;
        radiusX = Math.min(width * 0.13, 74);
        radiusY = Math.min(height * 0.14, 52);
      } else if (index > 8) {
        ringCount = 16;
        ringIndex = index - 9;
        radiusX = Math.min(width * 0.27, 150);
        radiusY = Math.min(height * 0.29, 104);
      }

      const angle = angleOffset + (ringIndex / ringCount) * Math.PI * 2;
      return {
        x: width / 2 - nodeWidth / 2 + Math.cos(angle) * radiusX,
        y: height / 2 - nodeHeight / 2 + Math.sin(angle) * radiusY
      };
    }

    function applyOrbit(angleOffset, duration) {
      nodes.forEach(({ node }, index) => {
        const position = orbitPosition(node, index, angleOffset);
        node.style.transitionDuration = `${duration}ms`;
        node.style.transform = `translate3d(${position.x}px, ${position.y}px, 0) rotate(${angleOffset}rad)`;
      });
    }

    function enableChoice() {
      canChoose = true;
      board.dataset.ready = "true";
      board.dataset.phase = "ready";
      nodes.forEach(({ node }) => {
        node.disabled = false;
      });
      prompt.textContent = BLIND_LEVELS[levelIndex].finalSpin
        ? "旋转结束，选中刚才发光的盲盒"
        : "交换结束，选中刚才发光的盲盒";
      audio.collect();
    }

    function runFinalSpin(step = 0) {
      const spinSteps = 5;
      const spinDuration = 320;
      if (step >= spinSteps) {
        board.dataset.phase = "scattering";
        board.classList.remove("orbiting");
        prompt.textContent = "盲盒正在散开归位…";
        applyPositions(true, 720);
        later(enableChoice, 780);
        return;
      }

      board.dataset.phase = "spinning";
      board.classList.add("orbiting");
      prompt.textContent = "所有盲盒正在中央旋转，盯紧它！";
      applyOrbit((step + 1) * Math.PI * 0.72, spinDuration);
      if (step % 2 === 0) audio.tone(350 + step * 45, 0.05, "square", 0.014);
      later(() => runFinalSpin(step + 1), spinDuration);
    }

    function gatherFinalBoxes() {
      board.dataset.phase = "gathering";
      board.classList.add("orbiting");
      prompt.textContent = "盲盒正在向中央聚拢…";
      applyOrbit(0, 620);
      later(() => runFinalSpin(), 680);
    }

    function swapOnce() {
      if (completed) return;
      const firstIndex = Math.floor(Math.random() * nodes.length);
      let secondIndex = Math.floor(Math.random() * nodes.length);
      if (secondIndex === firstIndex) secondIndex = (secondIndex + 1) % nodes.length;
      [nodes[firstIndex].slot, nodes[secondIndex].slot] = [nodes[secondIndex].slot, nodes[firstIndex].slot];
      nodes[firstIndex].node.classList.add("swapping");
      nodes[secondIndex].node.classList.add("swapping");
      applyPositions(true);
      later(() => {
        nodes[firstIndex]?.node.classList.remove("swapping");
        nodes[secondIndex]?.node.classList.remove("swapping");
      }, BLIND_LEVELS[levelIndex].speed);
    }

    function runShuffle(step = 0) {
      const level = BLIND_LEVELS[levelIndex];
      if (step >= level.swaps) {
        enableChoice();
        return;
      }
      swapOnce();
      if (step % 4 === 0) audio.tone(310 + (step % 3) * 40, 0.025, "square", 0.012);
      later(() => runShuffle(step + 1), level.speed);
    }

    function chooseBox(node) {
      if (!canChoose || completed) return;
      const level = BLIND_LEVELS[levelIndex];
      canChoose = false;
      board.dataset.ready = "false";
      nodes.forEach(({ node: box }) => {
        box.disabled = true;
      });

      const guaranteedHit = failedAttempts >= 2;
      if (node.dataset.target !== "true" && !guaranteedHit) {
        failedAttempts += 1;
        node.classList.add("wrong");
        prompt.textContent = "没有选中，目标盲盒重新出现并再次挑战";
        audio.bump();
        later(() => renderRound(), 900);
        return;
      }

      node.classList.add("chosen");
      createConfetti(node);
      window.magic?.burstEl(node, levelIndex === BLIND_LEVELS.length - 1 ? "jackpot" : "matchFound");
      audio.success();
      if (levelIndex === BLIND_LEVELS.length - 1) {
        completed = true;
        prompt.textContent = "25 盒中选，欧气爆棚！";
        later(() => completeGame("blind", "三关全部命中！", message), 750);
        return;
      }
      prompt.textContent = `第 ${levelIndex + 1} 关命中！`;
      later(() => {
        levelIndex += 1;
        failedAttempts = 0;
        renderRound();
      }, 950);
    }

    function renderRound() {
      const level = BLIND_LEVELS[levelIndex];
      board.replaceChildren();
      board.classList.toggle("final-mode", Boolean(level.finalSpin));
      board.classList.remove("orbiting");
      board.dataset.ready = "false";
      board.dataset.phase = "preview";
      levelScore.textContent = `${levelIndex + 1} / 3`;
      prompt.textContent = "记住正在发光的幸运盲盒";
      canChoose = false;
      const targetIndex = Math.floor(Math.random() * level.count);
      nodes = [];

      for (let index = 0; index < level.count; index += 1) {
        const node = document.createElement("button");
        node.type = "button";
        node.className = `blind-box${level.count >= 25 ? " mini-box" : ""}`;
        node.dataset.box = String(index);
        node.dataset.target = String(index === targetIndex);
        node.disabled = true;
        node.innerHTML = '<span class="box-lid"></span><span class="box-body"><i>?</i></span>';
        board.appendChild(node);
        nodes.push({ node, slot: index });
        listen(node, "pointerup", () => chooseBox(node));
      }
      applyPositions(false);
      const target = nodes[targetIndex].node;
      target.classList.add("target-preview");
      later(() => {
        target.classList.remove("target-preview");
        if (level.finalSpin) {
          gatherFinalBoxes();
        } else {
          prompt.textContent = "快速交换中，盯紧它！";
          runShuffle();
        }
      }, level.finalSpin ? 1200 : 900);
    }

    later(renderRound, 40);
    addCleanup(() => {
      board.replaceChildren();
      board.dataset.ready = "false";
      document.querySelectorAll(".confetti").forEach((node) => node.remove());
    });
  }

  const AITIPS_NOTES = [
    { src: "assets/kenney/heart.png", word: "心动", tone: 523 },
    { src: "assets/hello-kitty/kitty-bow.png", word: "每天", tone: 587 },
    { src: "assets/kenney/diamond.png", word: "早安", tone: 659 },
    { src: "assets/kenney/key.png", word: "想你", tone: 698 },
    { src: "assets/kenney/green-potion.png", word: "晚安", tone: 784 },
    { src: "assets/kenney/coin.png", word: "陪你", tone: 880 }
  ];
  const AITIPS_LEVELS = [
    { pads: 4, length: 3 },
    { pads: 4, length: 4 },
    { pads: 6, length: 5 }
  ];

  function enterAitips() {
    const board = document.querySelector("#aitips-board");
    const prompt = document.querySelector("#aitips-prompt");
    const levelScore = document.querySelector("#aitips-level-score");
    const lenNode = document.querySelector("#aitips-len");
    const tip = document.querySelector("#aitips-tip");
    const message = document.querySelector("#aitips-message");
    let levelIndex = 0;
    let sequence = [];
    let inputIndex = 0;
    let accepting = false;
    let completed = false;
    let padNodes = [];

    function setEnabled(enabled) {
      padNodes.forEach((node) => {
        node.disabled = !enabled;
      });
    }

    function flashPad(index, duration) {
      const node = padNodes[index];
      if (!node) return;
      node.classList.add("lit");
      window.magic?.pulse();
      audio.tone(AITIPS_NOTES[index].tone, 0.16, "square", 0.04);
      later(() => node.classList.remove("lit"), duration);
    }

    function playSequence() {
      if (completed) return;
      accepting = false;
      inputIndex = 0;
      setEnabled(false);
      board.dataset.ready = "false";
      prompt.textContent = "AI 正在写下今天的便利贴…";
      tip.textContent = "看 AI 点亮便利贴的顺序";
      const step = 640;
      sequence.forEach((padIndex, order) => {
        later(() => flashPad(padIndex, step * 0.6), 520 + order * step);
      });
      later(() => {
        accepting = true;
        setEnabled(true);
        board.dataset.ready = "true";
        prompt.textContent = "照着顺序点亮便利贴";
        tip.textContent = `还需点亮 ${sequence.length} 张`;
      }, 560 + sequence.length * step);
    }

    function finishLevel() {
      audio.collect();
      if (levelIndex === AITIPS_LEVELS.length - 1) {
        completed = true;
        prompt.textContent = "便利贴全部记住啦！";
        showLevelMessage(message, "心动备忘完成！");
        later(() => completeGame("aitips", "三关全部记住！", message), 700);
        return;
      }
      prompt.textContent = `第 ${levelIndex + 1} 关记住啦！`;
      showLevelMessage(message, `第 ${levelIndex + 1} 关通过！`);
      later(() => {
        levelIndex += 1;
        renderLevel();
      }, 1050);
    }

    function handleTap(index) {
      if (!accepting || completed) return;
      flashPad(index, 300);
      const node = padNodes[index];
      if (sequence[inputIndex] === index) {
        inputIndex += 1;
        node.classList.remove("correct");
        void node.offsetWidth;
        node.classList.add("correct");
        window.magic?.burstEl(node, "padCorrect");
        const left = sequence.length - inputIndex;
        tip.textContent = left > 0 ? `还需点亮 ${left} 张` : "全部正确！";
        if (inputIndex >= sequence.length) {
          accepting = false;
          setEnabled(false);
          board.dataset.ready = "false";
          finishLevel();
        }
      } else {
        accepting = false;
        setEnabled(false);
        board.dataset.ready = "false";
        audio.bump();
        node.classList.add("wrong");
        prompt.textContent = "顺序乱了，AI 再写一遍～";
        tip.textContent = "重新记住顺序";
        later(() => node.classList.remove("wrong"), 480);
        later(playSequence, 1000);
      }
    }

    function renderLevel() {
      const level = AITIPS_LEVELS[levelIndex];
      board.replaceChildren();
      board.style.setProperty("--aitips-cols", String(level.pads <= 4 ? 2 : 3));
      board.dataset.ready = "false";
      levelScore.textContent = `${levelIndex + 1} / 3`;
      if (lenNode) lenNode.textContent = String(level.length);
      padNodes = [];

      for (let index = 0; index < level.pads; index += 1) {
        const note = AITIPS_NOTES[index];
        const node = document.createElement("button");
        node.type = "button";
        node.className = "aitips-note";
        node.dataset.pad = String(index);
        node.disabled = true;
        node.innerHTML = `<span class="note-glyph"><img src="${note.src}" alt="" draggable="false"></span><span class="note-word">${note.word}</span>`;
        node.setAttribute("aria-label", `便利贴 ${note.word}`);
        board.appendChild(node);
        padNodes.push(node);
        listen(node, "pointerup", () => handleTap(index));
      }

      sequence = [];
      for (let index = 0; index < level.length; index += 1) {
        sequence.push(Math.floor(Math.random() * level.pads));
      }
      board.dataset.sequence = sequence.join(",");
      inputIndex = 0;
      later(playSequence, 760);
    }

    later(renderLevel, 40);
    addCleanup(() => {
      board.replaceChildren();
      board.dataset.ready = "false";
    });
  }

  function enterFinal(options = {}) {
    const stage = document.querySelector("#final-stage");
    const panel = document.querySelector("#password-panel");
    const reveal = document.querySelector("#final-reveal");
    const display = document.querySelector("#password-display");
    const feedback = document.querySelector("#password-feedback");
    const status = document.querySelector("#final-status");
    const keypad = document.querySelector("#keypad");
    state.password = "";
    stage.classList.remove("summoning");
    panel.classList.remove("shake", "ritual-hide");
    reveal.classList.remove("show");
    document.querySelector("#final-copy").textContent = "";
    [...keypad.querySelectorAll("button")].forEach((button) => {
      button.disabled = false;
    });

    if (options.revealCompleted || state.finalCompleted) {
      panel.classList.add("ritual-hide");
      reveal.classList.add("show");
      status.textContent = "召唤成功";
      document.querySelector("#final-copy").textContent =
        "召唤成功，大疆 Pocket 4 已解锁。请在现实世界接收你的礼物。";
      return;
    }

    status.textContent = "法阵等待回应";
    feedback.textContent = "密码提示：六月的特别日子";
    updatePasswordDisplay(display);

    [...keypad.querySelectorAll("button")].forEach((button) => {
      listen(button, "pointerup", () => {
        if (stage.classList.contains("summoning")) return;
        audio.click();
        const key = button.dataset.key;
        if (/^\d$/.test(key) && state.password.length < 4) {
          state.password += key;
          updatePasswordDisplay(display);
          return;
        }
        if (key === "delete") {
          state.password = state.password.slice(0, -1);
          updatePasswordDisplay(display);
          return;
        }
        if (key === "confirm") {
          if (state.password === PASSWORD) {
            beginFinalSummon(stage, panel, reveal, feedback, status, keypad);
          } else {
            wrongPassword(panel, feedback, display);
          }
        }
      });
    });
  }

  function updatePasswordDisplay(display) {
    [...display.children].forEach((slot, index) => {
      slot.classList.toggle("filled", index < state.password.length);
    });
    display.setAttribute("aria-label", `已输入 ${state.password.length} 位密码`);
    window.magic?.setCharge(state.password.length / 4);
  }

  function wrongPassword(panel, feedback, display) {
    audio.bump();
    panel.classList.remove("shake");
    void panel.offsetWidth;
    panel.classList.add("shake");
    feedback.textContent = "法阵还没有回应，再想想这个特别的日期";
    state.password = "";
    updatePasswordDisplay(display);
    later(() => {
      panel.classList.remove("shake");
    }, 500);
  }

  function beginFinalSummon(stage, panel, reveal, feedback, status, keypad) {
    feedback.textContent = "密码正确，礼物能量开始共鸣…";
    status.textContent = "召唤进行中";
    [...keypad.querySelectorAll("button")].forEach((button) => {
      button.disabled = true;
    });
    panel.classList.add("ritual-hide");
    stage.classList.add("summoning");
    audio.success();
    window.magic?.setCharge(1);
    later(() => {
      window.magic?.finalReveal();
      audio.tone(1047, 0.7, "sine", 0.05);
    }, 2500);
    later(() => {
      reveal.classList.add("show");
      status.textContent = "召唤成功";
      typeFinalCopy();
      stopHomeSong(700);
      // Award fanfare has finished — let the love song carry the moment.
      playLoveSong();
    }, 3200);
    later(() => {
      state.finalCompleted = true;
      state.currentScene = "final";
      saveState();
    }, 4400);
  }

  function typeFinalCopy() {
    const node = document.querySelector("#final-copy");
    const copy = "召唤成功，大疆 Pocket 4 已解锁。请在现实世界接收你的礼物。";
    node.textContent = "";
    let index = 0;
    const typeNext = () => {
      node.textContent = copy.slice(0, index);
      index += 1;
      if (index <= copy.length) later(typeNext, 55);
    };
    typeNext();
  }

  function enterBackButtons() {
    document.querySelectorAll(".back-button").forEach((button) => {
      button.addEventListener("pointerup", () => {
        if (!button.closest(".scene")?.classList.contains("active")) return;
        if (transitionLocked) return;
        audio.click();
        showScene(button.dataset.back);
      });
    });
  }

  function resetProgress() {
    resetTapCount = 0;
    window.clearTimeout(resetTapTimer);
    localStorage.removeItem(STORAGE_KEY);
    state = clone(defaultState);
    audio.bump();
    flash.classList.remove("flash");
    void flash.offsetWidth;
    flash.classList.add("flash");
    showScene("start", { force: true });
  }

  function registerResetTap() {
    resetTapCount += 1;
    window.clearTimeout(resetTapTimer);
    resetTapTimer = window.setTimeout(() => {
      resetTapCount = 0;
    }, 2600);
    if (resetTapCount < 5) return;

    resetProgress();
  }

  function enterResetControls() {
    const openButton = document.querySelector("#reset-progress-button");
    const dialog = document.querySelector("#reset-confirm");
    const cancelButton = document.querySelector("#reset-cancel-button");
    const confirmButton = document.querySelector("#reset-confirm-button");

    const closeDialog = () => {
      dialog.classList.remove("show");
      dialog.setAttribute("aria-hidden", "true");
      openButton.focus({ preventScroll: true });
    };

    openButton.addEventListener("pointerup", () => {
      audio.init();
      audio.click();
      dialog.classList.add("show");
      dialog.setAttribute("aria-hidden", "false");
      cancelButton.focus({ preventScroll: true });
    });
    cancelButton.addEventListener("pointerup", closeDialog);
    confirmButton.addEventListener("pointerup", () => {
      dialog.classList.remove("show");
      dialog.setAttribute("aria-hidden", "true");
      resetProgress();
    });
    dialog.addEventListener("pointerup", (event) => {
      if (event.target === dialog) closeDialog();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dialog.classList.contains("show")) closeDialog();
    });
  }

  function syncViewportSize() {
    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width || window.innerWidth);
    const height = Math.round(viewport?.height || window.innerHeight);
    document.documentElement.style.setProperty("--app-width", `${width}px`);
    document.documentElement.style.setProperty("--app-height", `${height}px`);
    // Uniformly scale the fixed 1280x720 design canvas to fit the screen, the
    // way an image is zoomed: relative layout is preserved, only absolute size
    // changes. "contain" fit (min) keeps the whole stage visible (letterboxed).
    const DESIGN_WIDTH = 1280;
    const DESIGN_HEIGHT = 720;
    const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
    shellScale = scale > 0 ? scale : 1;
    document.documentElement.style.setProperty("--shell-scale", String(scale));
  }

  function isFullscreen() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function updateFullscreenButton() {
    if (!fullscreenButton) return;
    fullscreenButton.textContent = isFullscreen() ? "退出全屏" : "全屏";
  }

  async function toggleFullscreen() {
    const root = document.documentElement;

    try {
      if (isFullscreen()) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        }
        return;
      }
      if (root.requestFullscreen) {
        await root.requestFullscreen({ navigationUI: "hide" });
      } else if (root.webkitRequestFullscreen) {
        await root.webkitRequestFullscreen();
      } else {
        showSystemToast("当前 iOS 浏览器不能直接隐藏地址栏。请点分享，再选择“添加到主屏幕”，从桌面打开即可全屏。");
        window.scrollTo(0, 1);
        return;
      }
      try {
        await screen.orientation?.lock?.("landscape");
      } catch {
        // Orientation locking is optional and unsupported on some mobile browsers.
      }
    } catch {
      showSystemToast("浏览器没有允许进入全屏。可将网页添加到主屏幕后重新打开。");
    } finally {
      updateFullscreenButton();
      syncViewportSize();
    }
  }

  function enterPersistentControls() {
    syncViewportSize();
    window.addEventListener("resize", syncViewportSize);
    window.visualViewport?.addEventListener("resize", syncViewportSize);
    window.visualViewport?.addEventListener("scroll", syncViewportSize);

    musicToggleButton?.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      audio.init();
      if (homeSong?.paused) {
        playHomeSong();
      } else {
        pauseHomeSong();
      }
    });
    homeSong?.addEventListener("play", updateMusicButton);
    homeSong?.addEventListener("pause", updateMusicButton);
    homeSong?.addEventListener("error", () => {
      musicToggleButton.classList.remove("needs-action", "playing");
      musicToggleButton.textContent = "音乐不可用";
      musicToggleButton.disabled = true;
    });

    fullscreenButton?.addEventListener("pointerup", toggleFullscreen);
    document.addEventListener("fullscreenchange", updateFullscreenButton);
    document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
    updateMusicButton();
    updateFullscreenButton();
  }

  const sceneEntrances = {
    start: enterStart,
    hub: enterHub,
    stella: enterStella,
    dog: enterDog,
    hand: enterHand,
    blind: enterBlind,
    aitips: enterAitips,
    final: enterFinal
  };

  function preventBrowserGestures() {
    ["contextmenu", "dragstart", "selectstart"].forEach((eventName) => {
      document.addEventListener(eventName, (event) => event.preventDefault());
    });
    document.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
    document.addEventListener("touchmove", (event) => {
      if (event.touches.length > 1) event.preventDefault();
    }, { passive: false });
  }

  preventBrowserGestures();
  enterBackButtons();
  enterResetControls();
  enterPersistentControls();
  document.querySelector(".secret-reset-title").addEventListener("pointerup", registerResetTap);
  document.querySelector("#secret-reset-corner").addEventListener("pointerup", registerResetTap);
  showScene("start", { force: true });

  window.giftSummonGame = Object.freeze({
    getState: () => clone(state),
    reset: resetProgress
  });
})();
