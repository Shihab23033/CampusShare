const dashboard = window.CampusShare;
const listingsElement = document.querySelector('#my-listings');
const requestsElement = document.querySelector('#my-requests');
const pitchesElement = document.querySelector('#need-pitches');
const editDialog = document.querySelector('#edit-dialog');
const editForm = document.querySelector('#edit-listing-form');
let editingItemId = null;
let existingImages = [];
let dashboardUser;
let activeTab = 'donations';

function activateTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-button').forEach((button) => {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.id !== `tab-${tab}`;
  });
}

document.querySelectorAll('.tab-button').forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
});

function handleHashNavigation() {
  if (window.location.hash === '#new-listing') {
    activateTab('donations');
    document.querySelector('#new-listing')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
window.addEventListener('hashchange', handleHashNavigation);

function statusMarkup(status) {
  const labels = { pending: 'In review', approved: 'Available', rejected: 'Not approved', donated: 'Donated', accepted: 'Accepted', declined: 'Not selected' };
  return `<span class="status-tag status-${dashboard.escapeHtml(status)}">${labels[status] || dashboard.escapeHtml(status)}</span>`;
}

function renderListings(items) {
  document.querySelector('#listing-count').textContent = items.length;
  if (!items.length) {
    listingsElement.innerHTML = '<div class="empty-state">No listings yet. Offer something you no longer need.</div>';
    return;
  }

  listingsElement.innerHTML = items.map((item) => `
    <article class="manage-row">
      <div class="manage-image">${item.image_url ? `<img src="${dashboard.escapeHtml(item.image_url)}" alt="">` : '<span aria-hidden="true">＋</span>'}</div>
      <div class="manage-copy"><div class="manage-title-line"><h3>${dashboard.escapeHtml(item.title)}</h3>${statusMarkup(item.status)}</div>
        <p>${dashboard.escapeHtml(item.category)} · ${dashboard.formatDate(item.created_at)}</p>
        <p class="manage-description">${dashboard.escapeHtml(item.description)}</p>
      </div>
      <div class="manage-actions">${item.status !== 'donated' ? `<button class="quiet-button edit-listing" data-item-id="${item.id}" type="button">Edit</button>` : ''}${item.status === 'approved' ? `<button class="quiet-button request-toggle" data-item-id="${item.id}" type="button">Need pitches <span>${item.request_count}</span></button>` : `<span class="section-count">${item.request_count} requests</span>`}</div>
      <div class="pitch-panel" id="pitches-${item.id}" hidden></div>
    </article>`).join('');

  listingsElement.querySelectorAll('.request-toggle').forEach((button) => button.addEventListener('click', () => togglePitches(button)));
  listingsElement.querySelectorAll('.edit-listing').forEach((button) => button.addEventListener('click', () => openEditListing(button)));
}

function renderExistingPhotos(images) {
  const container = document.querySelector('#edit-existing-images');
  container.replaceChildren();
  if (!images.length) {
    const empty = document.createElement('span');
    empty.className = 'field-hint';
    empty.textContent = 'No current photos.';
    container.append(empty);
    return;
  }
  images.forEach((photo, index) => {
    const figure = document.createElement('figure');
    figure.className = `image-preview${photo.isCover ? ' is-cover' : ''}`;
    if (!photo.isCover && photo.id) {
      figure.dataset.coverImageId = String(photo.id);
      figure.tabIndex = 0;
      figure.setAttribute('role', 'button');
      figure.setAttribute('aria-label', `Make photo ${index + 1} the cover photo`);
    }
    const image = document.createElement('img');
    image.src = photo.url;
    image.alt = `Current item photo ${index + 1}`;
    const chip = document.createElement('span');
    chip.className = 'cover-chip';
    chip.textContent = photo.isCover ? 'Cover' : 'Make cover';
    const caption = document.createElement('figcaption');
    caption.textContent = photo.isCover ? 'Cover photo' : `Photo ${index + 1}`;
    figure.append(image, chip, caption);
    container.append(figure);
  });
}

async function setExistingCover(event) {
  const figure = event.target && event.target.closest ? event.target.closest('figure[data-cover-image-id]') : null;
  if (!figure || !event.currentTarget.contains(figure) || !editingItemId) return;
  const imageId = Number(figure.dataset.coverImageId);
  const toast = dashboard.notify('Updating cover photo…', 'loading', 0);
  try {
    await dashboard.api(`/api/items/${editingItemId}/cover`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId })
    });
    existingImages = existingImages.map((photo) => ({ ...photo, isCover: photo.id === imageId }));
    renderExistingPhotos(existingImages);
    toast.update('Cover photo updated.', 'success');
    await loadDashboard();
  } catch (error) {
    toast.update(error.message, 'error', 6000);
  }
}

const existingImagesContainer = document.querySelector('#edit-existing-images');
existingImagesContainer.addEventListener('click', setExistingCover);
existingImagesContainer.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  setExistingCover(event);
});

async function openEditListing(button) {
  dashboard.setBusy(button, true, 'Loading…');
  const toast = dashboard.notify('Loading listing…', 'loading', 0);
  try {
    const data = await dashboard.api(`/api/items/${button.dataset.itemId}`);
    const item = data.item;
    editingItemId = item.id;
    editForm.elements.title.value = item.title;
    editForm.elements.category.value = item.category;
    editForm.elements.description.value = item.description;
    editForm.elements.images.value = '';
    document.querySelector('#edit-feedback').textContent = '';
    existingImages = item.imageData || (item.images || []).map((url) => ({ id: null, url, isCover: false }));
    if (existingImages.length && !existingImages.some((photo) => photo.isCover)) {
      existingImages[0] = { ...existingImages[0], isCover: true };
    }
    renderExistingPhotos(existingImages);
    editPicker.reset();
    editDialog.showModal();
    toast.update('Listing loaded for editing.', 'success', 1800);
  } catch (error) {
    toast.update(error.message, 'error', 6000);
  } finally {
    dashboard.setBusy(button, false);
  }
}

async function togglePitches(button) {
  const panel = document.querySelector(`#pitches-${button.dataset.itemId}`);
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.innerHTML = '<p class="empty-state">Loading requests…</p>';
  try {
    const data = await dashboard.api(`/api/requests/item/${button.dataset.itemId}`);
    if (!data.requests.length) {
      panel.innerHTML = '<p class="empty-state">No one has requested this listing yet.</p>';
      return;
    }
    panel.innerHTML = data.requests.map((request) => `
      <div class="pitch-row"><div><strong>${dashboard.escapeHtml(request.requester_name)}</strong>${statusMarkup(request.status)}<p>${dashboard.escapeHtml(request.need_pitch)}</p></div>
        <div class="pitch-actions">${request.status === 'pending' ? `<a class="quiet-button" href="/chat.html?requestId=${request.id}">Message</a><button class="btn btn-share accept-request" data-item-id="${button.dataset.itemId}" data-requester-id="${request.requester_id}" type="button">Choose student</button>` : request.status === 'accepted' ? `<a class="quiet-button" href="/chat.html?requestId=${request.id}">Open chat</a>` : ''}</div>
      </div>`).join('');
    panel.querySelectorAll('.accept-request').forEach((acceptButton) => acceptButton.addEventListener('click', acceptRequest));
  } catch (error) {
    panel.innerHTML = `<p class="form-feedback">${dashboard.escapeHtml(error.message)}</p>`;
  }
}

async function acceptRequest(event) {
  const button = event.currentTarget;
  if (!window.confirm('Choose this student? Other pending requests will be declined, the listing will be marked donated, and you will earn one point.')) return;
  dashboard.setBusy(button, true, 'Confirming…');
  const toast = dashboard.notify('Confirming recipient…', 'loading', 0);
  try {
    await dashboard.api(`/api/items/${button.dataset.itemId}/donated`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requesterId: button.dataset.requesterId })
    });
    toast.update('Recipient selected. Listing marked donated and one point awarded.', 'success');
    await loadDashboard();
  } catch (error) {
    dashboard.setBusy(button, false);
    toast.update(error.message, 'error', 6000);
    dashboard.showNotice(error.message);
  }
}

function renderRequests(requests) {
  document.querySelector('#request-count').textContent = requests.length;
  if (!requests.length) {
    requestsElement.innerHTML = '<div class="empty-state">You have not requested an item yet. Browse the latest listings.</div>';
    return;
  }
  requestsElement.innerHTML = requests.map((request) => `
    <article class="request-row"><div><h3>${dashboard.escapeHtml(request.item_title)}</h3><p>Donated by ${dashboard.escapeHtml(request.donor_name)} · ${dashboard.formatDate(request.created_at)}</p></div>
      <div class="request-row-actions">${statusMarkup(request.status)}${request.status !== 'declined' ? `<a class="quiet-button" href="/chat.html?requestId=${request.id}">Open chat</a>` : ''}</div>
    </article>`).join('');
}

function renderPitches(pitches) {
  document.querySelector('#pitch-count').textContent = pitches.length;
  if (!pitches.length) {
    pitchesElement.innerHTML = '<div class="empty-state">No one has sent a Need Pitch yet. Approved listings can be found by students who need them.</div>';
    return;
  }
  pitchesElement.innerHTML = pitches.map((pitch) => {
    const canChoose = pitch.status === 'pending' && pitch.item_status === 'approved';
    return `
    <article class="pitch-entry">
      <div class="pitch-entry-head">
        <div><h3>${dashboard.escapeHtml(pitch.item_title)}</h3>
          <p class="pitch-meta">${dashboard.escapeHtml(pitch.requester_name)} · ${dashboard.formatDate(pitch.created_at)}</p></div>
        <div class="pitch-entry-tags">${statusMarkup(pitch.status)}${pitch.item_status !== 'approved' ? statusMarkup(pitch.item_status) : ''}</div>
      </div>
      <p class="pitch-text">${dashboard.escapeHtml(pitch.need_pitch)}</p>
      <div class="pitch-actions">${canChoose ? `<a class="quiet-button" href="/chat.html?requestId=${pitch.id}">Message</a><button class="btn btn-share accept-request" data-item-id="${pitch.item_id}" data-requester-id="${pitch.requester_id}" type="button">Choose student</button>` : pitch.status === 'accepted' ? `<a class="quiet-button" href="/chat.html?requestId=${pitch.id}">Open chat</a>` : ''}</div>
    </article>`;
  }).join('');
  pitchesElement.querySelectorAll('.accept-request').forEach((button) => button.addEventListener('click', acceptRequest));
}

async function loadDashboard() {
  try {
    const [listings, requests, pitches] = await Promise.all([
      dashboard.api('/api/items/mine'),
      dashboard.api('/api/requests/my-requests'),
      dashboard.api('/api/requests/my-pitches')
    ]);
    renderListings(listings.items);
    renderRequests(requests.requests);
    renderPitches(pitches.pitches);
    document.querySelector('#points-count').textContent = dashboardUser.doner_points;
    document.querySelector('#badge-name').textContent = dashboard.badgeForPoints(dashboardUser.doner_points);
  } catch (error) {
    dashboard.showNotice(error.message);
  }
}

const listingPicker = dashboard.imagePicker(
  document.querySelector('#listing-form [name="images"]'),
  document.querySelector('#listing-preview'),
  { onReject: (message) => dashboard.notify(message, 'error') }
);
const editPicker = dashboard.imagePicker(
  editForm.elements.images,
  document.querySelector('#edit-preview'),
  { onReject: (message) => dashboard.notify(message, 'error') }
);

document.querySelector('#listing-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const files = listingPicker.files;
  const feedback = document.querySelector('#listing-feedback');
  feedback.textContent = '';
  if (files.length < 1 || files.length > 5) {
    feedback.textContent = 'Choose between one and five photos.';
    dashboard.notify('Choose between one and five photos.', 'error');
    return;
  }
  if (files.some((file) => file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
    feedback.textContent = 'Each photo must be 5 MB or smaller.';
    dashboard.notify('Use JPEG, PNG, or WebP photos, each no larger than 5 MB.', 'error');
    return;
  }

  const button = form.querySelector('button[type="submit"]');
  dashboard.setBusy(button, true, 'Uploading photos…');
  const toast = dashboard.notify('Uploading photos and sending for review…', 'loading', 0);
  try {
    await dashboard.api('/api/items', { method: 'POST', body: dashboard.formDataWithImages(form, files) });
    form.reset();
    listingPicker.reset();
    toast.update('Listing sent for review.', 'success');
    feedback.className = 'form-feedback success-message';
    feedback.textContent = 'Submitted for moderation. It will appear in the feed after approval.';
    await loadDashboard();
  } catch (error) {
    feedback.textContent = error.message;
    toast.update(error.message, 'error', 6000);
  } finally {
    dashboard.setBusy(button, false);
  }
});

document.querySelector('#edit-cancel').addEventListener('click', () => {
  editDialog.close();
  editForm.reset();
  editPicker.reset();
});

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!editingItemId) return;
  const files = editPicker.files;
  const feedback = document.querySelector('#edit-feedback');
  feedback.textContent = '';
  if (files.length > 5 || files.some((file) => file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
    feedback.textContent = 'Choose up to five JPEG, PNG, or WebP images, each no larger than 5 MB.';
    dashboard.notify(feedback.textContent, 'error');
    return;
  }

  const button = editForm.querySelector('button[type="submit"]');
  dashboard.setBusy(button, true, files.length ? 'Uploading photos…' : 'Saving changes…');
  const toast = dashboard.notify(files.length ? 'Uploading photos and saving changes…' : 'Saving changes…', 'loading', 0);
  try {
    await dashboard.api(`/api/items/${editingItemId}`, { method: 'PUT', body: dashboard.formDataWithImages(editForm, files) });
    toast.update('Changes sent for admin review.', 'success');
    editDialog.close();
    editForm.reset();
    editPicker.reset();
    await loadDashboard();
  } catch (error) {
    feedback.textContent = error.message;
    toast.update(error.message, 'error', 6000);
  } finally {
    dashboard.setBusy(button, false);
  }
});

(async () => {
  dashboardUser = await dashboard.requireStudent();
  if (!dashboardUser) return;
  await loadDashboard();
  handleHashNavigation();
})();