const itemApp = window.CampusShare;
const itemId = new URLSearchParams(window.location.search).get('id');
let itemRecord;
let slideIndex = 0;

function renderCarousel(images, title) {
  const safeTitle = itemApp.escapeHtml(title);
  return `<div class="item-gallery">
    <div class="gallery-stage" aria-live="polite">
      ${images.map((url, index) => `<img class="gallery-slide${index === 0 ? ' active' : ''}" src="${itemApp.escapeHtml(url)}" alt="${safeTitle}, photo ${index + 1}" ${index ? 'loading="lazy"' : ''}>`).join('')}
      ${images.length ? '' : `<div class="gallery-fallback"><span>${safeTitle.slice(0, 1)}</span><p>No photos provided</p></div>`}
      ${images.length > 1 ? '<button class="gallery-control gallery-prev" type="button" aria-label="Previous photo">‹</button><button class="gallery-control gallery-next" type="button" aria-label="Next photo">›</button>' : ''}
    </div>
    <div class="gallery-footer"><div class="gallery-dots">${images.map((_, index) => `<button type="button" class="gallery-dot${index === 0 ? ' active' : ''}" data-slide="${index}" aria-label="Show photo ${index + 1}" aria-pressed="${index === 0}"></button>`).join('')}</div><span class="gallery-count">${images.length ? `1 / ${images.length}` : 'No photos'}</span></div>
  </div>`;
}

function showSlide(nextIndex) {
  const slides = [...document.querySelectorAll('.gallery-slide')];
  if (!slides.length || !itemRecord.images.length) return;
  slideIndex = (nextIndex + slides.length) % slides.length;
  slides.forEach((slide, index) => slide.classList.toggle('active', index === slideIndex));
  document.querySelectorAll('.gallery-dot').forEach((dot, index) => {
    dot.classList.toggle('active', index === slideIndex);
    dot.setAttribute('aria-pressed', String(index === slideIndex));
  });
  document.querySelector('.gallery-count').textContent = `${slideIndex + 1} / ${slides.length}`;
}

function renderItem(item) {
  itemRecord = item;
  const category = itemApp.escapeHtml(item.category);
  document.title = `${item.title} | CampusShare`;
  document.querySelector('#item-content').innerHTML = `
    ${renderCarousel(item.images, item.title)}
    <section class="item-information">
      <p class="eyebrow">${category} · FREE TO A STUDENT</p>
      <h1>${itemApp.escapeHtml(item.title)}</h1>
      <p class="item-date">Shared ${itemApp.formatDate(item.created_at)}</p>
      <p class="item-description">${itemApp.escapeHtml(item.description)}</p>
      <a class="donor-line" href="/public-profile.html?id=${item.donor_id}">
        <span class="donor-avatar">${item.donor_avatar ? `<img src="${itemApp.escapeHtml(item.donor_avatar)}" alt="">` : itemApp.escapeHtml(item.donor_name.slice(0, 1).toUpperCase())}</span>
        <span><strong>${itemApp.escapeHtml(item.donor_name)}</strong><small>View donor profile</small></span><span class="donor-arrow">→</span>
      </a>
      <form class="pitch-form" id="pitch-form">
        <label for="need-pitch">Why would this item help you?</label>
        <textarea id="need-pitch" name="needPitch" minlength="10" maxlength="2000" rows="5" required placeholder="Share a little context with the donor"></textarea>
        <div class="pitch-form-footer"><span class="field-hint">10–2,000 characters</span><button class="btn btn-share" type="submit" id="request-button">Send Need Pitch</button></div>
        <p class="form-feedback" id="pitch-feedback" role="status"></p>
      </form>
    </section>`;

  document.querySelector('.gallery-prev')?.addEventListener('click', () => showSlide(slideIndex - 1));
  document.querySelector('.gallery-next')?.addEventListener('click', () => showSlide(slideIndex + 1));
  document.querySelectorAll('.gallery-dot').forEach((dot) => dot.addEventListener('click', () => showSlide(Number(dot.dataset.slide))));
  document.querySelectorAll('.donor-avatar img').forEach((image) => image.addEventListener('error', () => {
    const fallback = document.createElement('span');
    fallback.textContent = item.donor_name.slice(0, 1).toUpperCase();
    image.replaceWith(fallback);
  }, { once: true }));
  const galleryStage = document.querySelector('.gallery-stage');
  let touchStartX = null;
  galleryStage?.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.gallery-control')) touchStartX = event.clientX;
  });
  galleryStage?.addEventListener('pointerup', (event) => {
    if (touchStartX === null) return;
    const distance = event.clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(distance) > 45) showSlide(slideIndex + (distance < 0 ? 1 : -1));
  });
  galleryStage?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') showSlide(slideIndex - 1);
    if (event.key === 'ArrowRight') showSlide(slideIndex + 1);
  });
  document.querySelector('#pitch-form').addEventListener('submit', submitPitch);
  loadCurrentUser();
}

async function loadCurrentUser() {
  try {
    const user = await itemApp.loadUser();
    if (user) {
      document.querySelectorAll('[data-user-name]').forEach((node) => { node.textContent = user.name; });
      document.querySelectorAll('[data-signout]').forEach((button) => button.addEventListener('click', async () => {
        itemApp.setBusy(button, true, 'Signing out…');
        const toast = itemApp.notify('Signing out…', 'loading', 0);
        try {
          await itemApp.api('/api/auth/logout', { method: 'POST' });
          toast.update('Signed out.', 'success', 1500);
          window.setTimeout(() => window.location.assign('/'), 250);
        } catch (error) {
          itemApp.setBusy(button, false);
          toast.update(error.message, 'error', 6000);
        }
      }));
      if (Number(user.id) === Number(itemRecord.donor_id)) {
        document.querySelector('#request-button').disabled = true;
        document.querySelector('#request-button').textContent = 'Your listing';
      }
    }
  } catch {}
}

async function submitPitch(event) {
  event.preventDefault();
  const user = await itemApp.loadUser().catch(() => null);
  if (!user) {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/?auth=1&next=${encodeURIComponent(next)}`);
    return;
  }
  if (Number(user.id) === Number(itemRecord.donor_id)) return;

  const button = document.querySelector('#request-button');
  const feedback = document.querySelector('#pitch-feedback');
  button.disabled = true;
  button.textContent = 'Sending…';
  feedback.textContent = '';
  const toast = itemApp.notify('Sending your Need Pitch…', 'loading', 0);
  try {
    await itemApp.api('/api/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: itemRecord.id, needPitch: document.querySelector('#need-pitch').value })
    });
    feedback.className = 'form-feedback success-message';
    feedback.textContent = 'Your Need Pitch was sent to the donor.';
    toast.update('Need Pitch sent to the donor.', 'success');
    document.querySelector('#need-pitch').disabled = true;
    button.textContent = 'Pitch sent';
  } catch (error) {
    feedback.textContent = error.message;
    toast.update(error.message, 'error', 6000);
    button.disabled = false;
    button.textContent = 'Send Need Pitch';
  }
}

if (!itemId || !/^\d+$/.test(itemId)) {
  itemApp.showNotice('This item link is not valid.');
  document.querySelector('#item-content').innerHTML = '';
} else {
  itemApp.api(`/api/items/${encodeURIComponent(itemId)}`)
    .then((data) => renderItem(data.item))
    .catch((error) => {
      document.querySelector('#item-content').innerHTML = '';
      itemApp.showNotice(error.message);
    });
}