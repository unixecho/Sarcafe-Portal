(() => {
  const body = document.body;
  const quickForm = document.querySelector('.quick-form');
  const consentForm = document.querySelector('.consent-form');
  const phoneInput = quickForm.elements.quickPhone;
  const phoneSummary = document.querySelector('[data-phone-summary]');
  const heroSlides = [...document.querySelectorAll('.hero-slide')];
  const heroProgress = [...document.querySelectorAll('.hero-progress span')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const menu = window.SARCAFE_MENU;
  let selectedCategory = menu.categories[0].id;
  let activeHero = 0;
  let heroTimer;

  function showHero(index) {
    activeHero = index;
    heroSlides.forEach((slide, slideIndex) => slide.classList.toggle('is-active', slideIndex === index));
    heroProgress.forEach((marker, markerIndex) => marker.classList.toggle('is-active', markerIndex === index));
  }

  function stopHero() {
    window.clearInterval(heroTimer);
    heroTimer = undefined;
  }

  function startHero() {
    stopHero();
    const shouldPause = reducedMotion.matches || document.hidden || body.dataset.screen !== 'welcome';
    body.classList.toggle('is-hero-paused', shouldPause);
    if (shouldPause) return;
    heroTimer = window.setInterval(() => showHero((activeHero + 1) % heroSlides.length), 8500);
  }

  function updateScreen(name) {
    body.dataset.screen = name;
    document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
    document.querySelectorAll('.screen-picker [data-screen]').forEach((button) => {
      if (button.dataset.screen === name) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    startHero();
    if (name === 'join') phoneInput.focus({ preventScroll: true });
  }

  function setScreen(name) {
    updateScreen(name);
  }

  function normalizePhone(value) { return value.replace(/\D/g, ''); }
  function validPhone(value) { return /^05\d{8}$/.test(normalizePhone(value)); }
  function formatPrice(value) { return `₪${value}`; }
  function clearSession() {
    quickForm.reset();
    consentForm.reset();
    phoneSummary.textContent = '—';
    document.querySelector('.quick-message').textContent = '';
    document.querySelector('.consent-message').textContent = '';
  }

  function renderMenu() {
    const tabs = document.querySelector('.category-tabs');
    tabs.replaceChildren(...menu.categories.map((category) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.role = 'tab';
      button.dataset.category = category.id;
      button.setAttribute('aria-selected', String(category.id === selectedCategory));
      button.textContent = category.title;
      return button;
    }));

    const category = menu.categories.find((item) => item.id === selectedCategory);
    const rows = category.items.map((item) => {
      const article = document.createElement('article');
      article.className = 'menu-item';
      const title = document.createElement('h2');
      title.textContent = item.name;
      const price = document.createElement('span');
      price.className = 'price';
      price.dir = 'ltr';
      price.textContent = formatPrice(item.price);
      article.append(title, price);
      const details = item.note || item.types?.join(' · ');
      if (details) {
        const note = document.createElement('p');
        note.textContent = details;
        article.append(note);
      }
      if (item.recommended || item.quantity !== undefined) {
        const badges = document.createElement('div');
        badges.className = 'badges';
        if (item.recommended) {
          const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = 'כדאי לטעום'; badges.append(badge);
        }
        if (item.quantity !== undefined) {
          const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = `נשארו ${item.quantity}`; badges.append(badge);
        }
        article.append(badges);
      }
      return article;
    });
    document.querySelector('.menu-content').replaceChildren(...rows);
  }

  document.addEventListener('click', (event) => {
    const screenButton = event.target.closest('[data-screen]');
    if (screenButton) setScreen(screenButton.dataset.screen);

    const categoryButton = event.target.closest('[data-category]');
    if (categoryButton) { selectedCategory = categoryButton.dataset.category; renderMenu(); }

    if (event.target.closest('[data-clear]')) clearSession();

    const orientationButton = event.target.closest('[data-toggle-orientation]');
    if (orientationButton) {
      body.classList.toggle('portrait');
      orientationButton.textContent = body.classList.contains('portrait') ? 'תצוגת רוחב' : 'תצוגת אורך';
    }
  });

  document.addEventListener('visibilitychange', startHero);
  reducedMotion.addEventListener?.('change', startHero);

  quickForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = document.querySelector('.quick-message');
    if (!validPhone(phoneInput.value)) {
      message.textContent = 'כתבו מספר נייד ישראלי בן 10 ספרות, שמתחיל ב־05.';
      phoneInput.focus();
      return;
    }
    message.textContent = '';
    phoneSummary.textContent = phoneInput.value.trim();
    setScreen('consent');
  });

  consentForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = document.querySelector('.consent-message');
    if (!consentForm.checkValidity()) {
      message.textContent = 'כדי להמשיך צריך שם פרטי ואישור להודעת הפרטיות.';
      consentForm.reportValidity();
      return;
    }
    clearSession();
    setScreen('success');
  });

  renderMenu();
  startHero();
})();
