
  // ── Dark mode ON by default ──
  let explorerMode = localStorage.getItem('rma-explorer') === 'true';
  let autoplay     = localStorage.getItem('rma-autoplay') === 'true';
  // default dark = true unless user explicitly saved 'false'
  let darkMode     = localStorage.getItem('rma-dark') !== 'false';

  let metIds   = null;
  let metExIds = null;
  let currentCtrl = null;
  let metaVisible = false;

  // Autoplay state
  let autoplayTimer       = null;
  let autoplayCountdown   = null;
  let preloadedArtwork    = null;   // { artData, blobUrl }
  let preloadCtrl         = null;
  const AUTOPLAY_DURATION = 30000;

  let progressValue    = 0;
  let progressInterval = null;

  const POPULAR_IDS = [
    436535, 437984, 438821, 459055, 436105, 435809, 437853,
    11417,  544512, 438728, 436944, 437645, 437406, 438722,
    436532, 437980, 435882, 436996, 438012, 437329,
  ];

  const hints = [
    'Try Explorer Mode for objects, prints & fragments',
    'Popular shows masterworks from The Met collection',
    'Autoplay rotates to a new work every 30 seconds',
    'Read more reveals title, date & department',
    '"View at museum" opens the original catalogue entry',
    'Switch to Dark mode for a gallery-at-night feel',
    'The Met has over 470,000 artworks with images',
  ];
  let hintIndex = 0;

  const $ = id => document.getElementById(id);

  const settingsBtn      = $('settings-btn');
  const dropdown         = $('dropdown');
  const explorerToggle   = $('explorer-toggle');
  const autoplayToggle   = $('autoplay-toggle');
  const darkToggle       = $('dark-toggle');
  const stage            = $('stage');
  const loadPanel        = $('load-panel');
  const imgWrap          = $('img-wrap');
  const progressTrack    = $('progress-track');
  const progressBar      = $('progress-bar');
  const loadStatus       = $('load-status');
  const img              = $('artwork-img');
  const credit           = $('credit');
  const readMoreBtn      = $('read-more-btn');
  const metadata         = $('metadata');
  const metTitle         = $('meta-title');
  const metArtist        = $('meta-artist');
  const metDate          = $('meta-date');
  const metDept          = $('meta-dept');
  const metLink          = $('meta-link');
  const errorMsg         = $('error-msg');
  const newArtBtn        = $('new-art-btn');
  const popularBtn       = $('popular-btn');
  const hintEl           = $('hint-display');
  const autoplayBarWrap  = $('autoplay-bar-wrap');
  const autoplayBarFill  = $('autoplay-bar-fill');

  // ── Hints ──────────────────────────────────────────────
  function cycleHint() {
    hintEl.classList.remove('active');
    hintEl.classList.add('exit');
    setTimeout(() => {
      hintIndex = (hintIndex + Math.floor(Math.random() * (hints.length - 1)) + 1) % hints.length;
      hintEl.textContent = hints[hintIndex];
      hintEl.classList.remove('exit');
      hintEl.classList.add('active');
    }, 500);
  }
  hintEl.textContent = hints[0];
  setInterval(cycleHint, 5000);

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ── Fetch progress bar ─────────────────────────────────
  function setProgress(pct, statusText) {
    progressValue = pct;
    progressBar.style.width = pct + '%';
    if (statusText !== undefined) loadStatus.textContent = statusText;
  }

  function startScan() {
    progressTrack.classList.add('scanning');
    progressBar.style.width = '0%';
  }

  function stopScan() {
    progressTrack.classList.remove('scanning');
  }

  function crawlTo(target, statusText, durationMs = 600) {
    return new Promise(res => {
      stopScan();
      if (statusText) loadStatus.textContent = statusText;
      const start = progressValue;
      const diff  = target - start;
      const fps   = 30;
      const steps = Math.round(durationMs / (1000 / fps));
      let step = 0;
      clearInterval(progressInterval);
      progressInterval = setInterval(() => {
        step++;
        const t    = step / steps;
        const ease = 1 - Math.pow(1 - t, 3);
        setProgress(start + diff * ease);
        if (step >= steps) {
          clearInterval(progressInterval);
          setProgress(target);
          res();
        }
      }, 1000 / fps);
    });
  }

  function loadImageWithProgress(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.timeout = 20000;

      xhr.onprogress = e => {
        if (e.lengthComputable) {
          stopScan();
          const pct   = 60 + (e.loaded / e.total) * 35;
          const kb    = Math.round(e.loaded / 1024);
          const total = Math.round(e.total  / 1024);
          setProgress(pct, `Downloading image — ${kb} / ${total} KB`);
        } else {
          progressTrack.classList.add('scanning');
          const kb = Math.round(e.loaded / 1024);
          loadStatus.textContent = `Downloading image — ${kb} KB received`;
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(URL.createObjectURL(xhr.response));
        } else {
          reject(new Error('Image fetch failed: ' + xhr.status));
        }
      };

      xhr.onerror   = () => reject(new Error('Network error loading image'));
      xhr.ontimeout = () => reject(new Error('Image load timed out'));
      xhr.send();
    });
  }

  // ── Autoplay countdown bar ─────────────────────────────
  function startCountdownBar() {
    stopCountdownBar();
    autoplayBarWrap.classList.add('active');

    // Reset without transition
    autoplayBarFill.classList.remove('running');
    autoplayBarFill.style.transform = 'scaleX(1)';

    // Force reflow then animate
    void autoplayBarFill.offsetWidth;
    autoplayBarFill.classList.add('running');
    autoplayBarFill.style.transitionDuration = AUTOPLAY_DURATION + 'ms';
    autoplayBarFill.style.transform = 'scaleX(0)';
  }

  function stopCountdownBar() {
    autoplayBarFill.classList.remove('running');
    autoplayBarFill.style.transitionDuration = '';
    autoplayBarWrap.classList.remove('active');
  }

  // ── Background preload for autoplay ───────────────────
  async function preloadNext(popular = false) {
    if (preloadCtrl) preloadCtrl.abort();
    preloadCtrl = new AbortController();
    const signal = preloadCtrl.signal;
    preloadedArtwork = null;

    try {
      const artData = popular ? await fetchPopular(signal) : await fetchMet(signal);
      const blobUrl = await loadImagePreloadSilent(artData.imageUrl, signal);
      if (!signal.aborted) {
        preloadedArtwork = { artData, blobUrl };
      }
    } catch (e) {
      // silently fail — main fetch will handle it
    }
  }

  function loadImagePreloadSilent(url, signal) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.timeout = 25000;

      if (signal) {
        signal.addEventListener('abort', () => { xhr.abort(); reject(new DOMException('Aborted', 'AbortError')); });
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(URL.createObjectURL(xhr.response));
        else reject(new Error('fetch failed'));
      };
      xhr.onerror   = () => reject(new Error('network error'));
      xhr.ontimeout = () => reject(new Error('timeout'));
      xhr.send();
    });
  }

  // ── Autoplay scheduler ────────────────────────────────
  function scheduleAutoplay(popular = false) {
    clearTimeout(autoplayTimer);
    if (!autoplay) return;

    startCountdownBar();

    // Begin preloading the next artwork immediately
    preloadNext(popular);

    autoplayTimer = setTimeout(async () => {
      await loadArtworkAutoplay(popular);
    }, AUTOPLAY_DURATION);
  }

  function cancelAutoplay() {
    clearTimeout(autoplayTimer);
    if (preloadCtrl) preloadCtrl.abort();
    preloadedArtwork = null;
    stopCountdownBar();
  }

  // ── Dark mode ─────────────────────────────────────────
  function applyDark() {
    const r = document.documentElement.style;
    if (darkMode) {
      r.setProperty('--bg',     '#111110');
      r.setProperty('--text',   '#e8e6e1');
      r.setProperty('--muted',  '#777');
      r.setProperty('--subtle', '#555');
      r.setProperty('--border', '#2a2a28');
      r.setProperty('--active', '#1e1e1c');
    } else {
      r.setProperty('--bg',     '#f5f4f0');
      r.setProperty('--text',   '#1a1a1a');
      r.setProperty('--muted',  '#888');
      r.setProperty('--subtle', '#bbb');
      r.setProperty('--border', '#e0dedd');
      r.setProperty('--active', '#e8e6e1');
    }
  }

  function syncUI() {
    explorerToggle.classList.toggle('active', explorerMode);
    autoplayToggle.classList.toggle('active', autoplay);
    darkToggle.classList.toggle('active', darkMode);
  }

  function hideError() { errorMsg.style.display = 'none'; }

  function showError(msg) {
    errorMsg.style.display = 'block';
    errorMsg.textContent   = msg;
    loadPanel.classList.add('hidden');
    newArtBtn.disabled        = false;
    popularBtn.disabled       = false;
    readMoreBtn.style.display = 'none';
    clearInterval(progressInterval);
  }

  function resetStage() {
    img.classList.remove('visible', 'decoding');
    img.src                   = '';
    imgWrap.style.display     = 'none';
    credit.textContent        = '';
    readMoreBtn.style.display = 'none';
    readMoreBtn.textContent   = 'Read more';
    metaVisible               = false;
    progressValue             = 0;
    progressBar.style.width   = '0%';
    loadStatus.textContent    = 'Contacting museum';
    metadata.classList.remove('visible');
    loadPanel.classList.remove('hidden');
    startScan();
  }

  async function renderArtwork({ blobUrl, title, artist, date, dept, museumUrl, creditLine }) {
    hideError();

    img.alt               = title + (artist ? ' by ' + artist : '');
    credit.textContent    = creditLine || '';
    metTitle.textContent  = title    || 'Untitled';
    metArtist.textContent = artist   || '';
    metDate.textContent   = date     || '';
    metDept.textContent   = dept     || '';
    metLink.href          = museumUrl || '#';

    await crawlTo(97, 'Decoding image', 300);

    img.src = blobUrl;
    img.classList.add('decoding');
    imgWrap.style.display = 'flex';

    try { await img.decode(); } catch (e) {}

    await crawlTo(100, 'Done', 200);
    await new Promise(r => setTimeout(r, 150));

    loadPanel.classList.add('hidden');
    stopScan();

    img.classList.remove('decoding');
    img.classList.add('visible');

    stage.classList.remove('fading');
    newArtBtn.disabled        = false;
    popularBtn.disabled       = false;
    readMoreBtn.style.display = '';
    cycleHint();
  }

  // ── Seamless autoplay switch (uses preloaded data if ready) ──
  async function loadArtworkAutoplay(popular = false) {
    if (currentCtrl) currentCtrl.abort();
    currentCtrl = new AbortController();

    newArtBtn.disabled  = true;
    popularBtn.disabled = true;
    stopCountdownBar();

    const cached = preloadedArtwork;
    preloadedArtwork = null;

    stage.classList.add('fading');
    await new Promise(r => setTimeout(r, 350));
    resetStage();
    stage.classList.remove('fading');
    hideError();

    if (cached) {
      // Instant render from preloaded blob
      try {
        await renderArtwork({ ...cached.artData, blobUrl: cached.blobUrl });
        scheduleAutoplay(popular);
        return;
      } catch (e) {
        // fall through to normal fetch
      }
    }

    // Fallback: normal fetch
    await doFetchAndRender(popular, currentCtrl.signal);
    scheduleAutoplay(popular);
  }

  // ── Normal manual load ────────────────────────────────
  async function loadArtwork(popular = false) {
    cancelAutoplay();

    if (currentCtrl) currentCtrl.abort();
    currentCtrl = new AbortController();
    const signal = currentCtrl.signal;

    newArtBtn.disabled  = true;
    popularBtn.disabled = true;

    stage.classList.add('fading');
    await new Promise(r => setTimeout(r, 350));
    resetStage();
    stage.classList.remove('fading');
    hideError();

    await doFetchAndRender(popular, signal);

    // Re-arm autoplay after manual navigation
    if (autoplay) scheduleAutoplay(popular);
  }

  async function doFetchAndRender(popular, signal) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const label = popular ? 'popular works' : 'The Met collection';
        await crawlTo(15, `Searching ${label}`, 400);

        const artData = popular ? await fetchPopular(signal) : await fetchMet(signal);
        const title   = artData.title.length > 40
          ? artData.title.slice(0, 40) + '…'
          : artData.title;

        await crawlTo(45, `Found "${title}"`, 300);
        await crawlTo(60, 'Requesting image from server', 200);

        const blobUrl = await loadImageWithProgress(artData.imageUrl);
        await renderArtwork({ ...artData, blobUrl });
        return;

      } catch (e) {
        if (e.name === 'AbortError') return;
        if (attempt < 2) {
          await crawlTo(0, `Retrying… (attempt ${attempt + 2})`, 300);
          startScan();
        }
      }
    }
    showError('Could not load artwork. Please try again.');
  }

  // ── Met API helpers ───────────────────────────────────
  async function fetchMetById(id, signal) {
    const r = await fetch(
      `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
      { signal }
    );
    const o        = await r.json();
    const imageUrl = o.primaryImageSmall || o.primaryImage;
    if (!imageUrl) throw new Error('No image for object ' + id);
    return {
      imageUrl,
      title:      o.title             || 'Untitled',
      artist:     o.artistDisplayName || '',
      date:       o.objectDate        || '',
      dept:       o.department        || '',
      museumUrl:  o.objectURL         || '',
      creditLine: 'The Metropolitan Museum of Art',
    };
  }

  async function fetchMet(signal) {
    const q = explorerMode ? '*' : 'painting';
    let ids = explorerMode ? metExIds : metIds;

    if (!ids) {
      const r = await fetch(
        `https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${q}`,
        { signal }
      );
      const d = await r.json();
      ids = d.objectIDs || [];
      if (explorerMode) metExIds = ids;
      else              metIds   = ids;
    }

    if (!ids.length) throw new Error('No results');

    for (let i = 0; i < 6; i++) {
      try {
        return await fetchMetById(pick(ids), signal);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
      }
    }

    throw new Error('No valid artwork found');
  }

  async function fetchPopular(signal) {
    const shuffled = [...POPULAR_IDS].sort(() => Math.random() - 0.5);
    for (const id of shuffled) {
      try {
        return await fetchMetById(id, signal);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
      }
    }
    throw new Error('Could not load a popular artwork');
  }

  // ── Event listeners ───────────────────────────────────
  settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  document.addEventListener('click', () => dropdown.classList.remove('open'));
  dropdown.addEventListener('click', e => e.stopPropagation());

  explorerToggle.addEventListener('click', () => {
    explorerMode = !explorerMode;
    localStorage.setItem('rma-explorer', explorerMode);
    metIds   = null;
    metExIds = null;
    syncUI();
    dropdown.classList.remove('open');
    loadArtwork(false);
  });

  autoplayToggle.addEventListener('click', () => {
    autoplay = !autoplay;
    localStorage.setItem('rma-autoplay', autoplay);
    syncUI();
    dropdown.classList.remove('open');
    if (autoplay) {
      scheduleAutoplay(false);
    } else {
      cancelAutoplay();
    }
  });

  darkToggle.addEventListener('click', () => {
    darkMode = !darkMode;
    localStorage.setItem('rma-dark', darkMode);
    applyDark();
    syncUI();
    dropdown.classList.remove('open');
  });

  readMoreBtn.addEventListener('click', () => {
    metaVisible = !metaVisible;
    metadata.classList.toggle('visible', metaVisible);
    readMoreBtn.textContent = metaVisible ? 'Hide details' : 'Read more';
  });

  newArtBtn.addEventListener('click',  () => loadArtwork(false));
  popularBtn.addEventListener('click', () => loadArtwork(true));

  // ── Init ──────────────────────────────────────────────
  applyDark();
  syncUI();
  loadArtwork(false);
