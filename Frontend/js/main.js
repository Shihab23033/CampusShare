const dashboard = window.CampusShare;

function apiFetch(url, options = {}) {
  return fetch(dashboard.apiUrl(url), { credentials: 'include', ...options });
}

const listingGrid = document.querySelector('#listing-grid');
const searchInput = document.querySelector('#search-input');
const authDialog = document.querySelector('#auth-dialog');
const donateDialog = document.querySelector('#donate-dialog');
const categories = document.querySelector('#categories');
let activeCategory = 'All';
let searchTimer;
let currentUser = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function renderListings(items) {
  document.querySelector('#feed-count').textContent = `${items.length} ${items.length === 1 ? 'listing' : 'listings'}`;
  if (!items.length) {
    listingGrid.innerHTML = '<div class="feed-message">Nothing here just yet. Try another category or check back soon.</div>';
    return;
  }

  listingGrid.innerHTML = items.map((item, index) => {
    const image = item.image_url
      ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title)}" loading="lazy">`
      : `<span class="image-fallback" aria-hidden="true">${escapeHtml(item.category.slice(0, 1))}</span>`;
    const donorInitial = escapeHtml(item.donor_name.slice(0, 1).toUpperCase());
    const avatar = item.donor_avatar
      ? `<img src="${escapeHtml(item.donor_avatar)}" data-fallback="${donorInitial}" alt="">`
      : donorInitial;

    return `<a class="listing-card listing-card-link" href="/item.html?id=${encodeURIComponent(item.id)}" style="animation-delay:${Math.min(index * 45, 360)}ms">
      <div class="listing-image">${image}<span class="listing-category">${escapeHtml(item.category)}</span></div>
      <div class="listing-copy"><h3>${escapeHtml(item.title)}</h3>
        <div class="listing-donor"><span class="donor-avatar">${avatar}</span><span>Shared by ${escapeHtml(item.donor_name)}</span></div>
      </div>
    </a>`;
  }).join('');
  listingGrid.querySelectorAll('.donor-avatar img').forEach((image) => image.addEventListener('error', () => {
    const fallback = document.createElement('span');
    fallback.textContent = image.dataset.fallback || '?';
    image.replaceWith(fallback);
  }, { once: true }));
}

async function loadListings() {
  const params = new URLSearchParams();
  const search = searchInput?.value.trim();
  if (search) params.set('search', search);
  if (activeCategory !== 'All') params.set('category', activeCategory);

  try {
    const response = await apiFetch(`/api/items?${params}`);
    if (!response.ok) throw new Error('Listings could not be loaded.');
    const data = await response.json();
    renderListings(data.items);
  } catch {
    listingGrid.innerHTML = '<div class="feed-message">Listings are unavailable right now. Check that the server and database are running.</div>';
  }
}

const authCopy = {
  login: { title: 'Welcome back', intro: 'Sign in to save useful things and pass yours along.', submit: 'Sign in', action: 'Signing in…' },
  register: { title: 'Join your community', intro: 'Make an account to give useful things a second life. We email you a six-digit code to verify your campus address.', submit: 'Create account', action: 'Creating account…' },
  verify: { title: 'Check your inbox', intro: 'Enter the six-digit code we emailed you to finish creating your account.', submit: 'Verify email', action: 'Verifying…' },
  forgot: { title: 'Reset your password', intro: 'Enter your account email and we will send a six-digit reset code.', submit: 'Send reset code', action: 'Sending code…' },
  reset: { title: 'Choose a new password', intro: 'Enter the six-digit reset code we emailed you and pick a new password.', submit: 'Reset password', action: 'Resetting password…' }
};
const authForms = {
  credentials: document.querySelector('#auth-form'),
  verify: document.querySelector('#otp-form'),
  forgot: document.querySelector('#forgot-form'),
  reset: document.querySelector('#reset-form')
};
const authDialogForms = Object.values(authForms);
let authMode = 'login';
let pendingAuthEmail = '';
let resendTimer;

function resetFeedback() {
  document.querySelectorAll('#auth-dialog .form-feedback').forEach((node) => {
    node.textContent = '';
    node.className = 'form-feedback';
  });
}

function fillEmail(value) {
  if (!value) return;
  authForms.credentials.elements.email.value = value;
  authForms.forgot.elements.email.value = value;
}

function setAuthMode(mode, options = {}) {
  authMode = mode;
  const copy = authCopy[mode];
  if (options.email) pendingAuthEmail = options.email;
  const credentialsMode = mode === 'login' || mode === 'register';
  const registering = mode === 'register';

  document.querySelector('#auth-title').textContent = copy.title;
  document.querySelector('#auth-intro').textContent = mode === 'verify' && pendingAuthEmail
    ? `We sent a six-digit code to ${pendingAuthEmail}. It expires in 10 minutes.`
    : copy.intro;
  authForms.credentials.classList.toggle('d-none', !credentialsMode);
  authForms.verify.classList.toggle('d-none', mode !== 'verify');
  authForms.forgot.classList.toggle('d-none', mode !== 'forgot');
  authForms.reset.classList.toggle('d-none', mode !== 'reset');

  document.querySelectorAll('.name-field, .department-field, .student-id-field').forEach((field) => {
    field.classList.toggle('d-none', !registering);
    const input = field.querySelector('input');
    input.disabled = !registering;
    input.required = registering;
  });
  authForms.credentials.elements.password.autocomplete = registering ? 'new-password' : 'current-password';
  if (credentialsMode) document.querySelector('#auth-submit').textContent = copy.submit;
  document.querySelector('#auth-switch').classList.toggle('d-none', !credentialsMode);
  document.querySelector('#auth-switch').textContent = registering ? 'Already a member? Sign in' : 'New here? Create an account';
  document.querySelector('#forgot-switch').classList.toggle('d-none', mode !== 'login');
  if (options.email || (credentialsMode && pendingAuthEmail)) fillEmail(options.email || pendingAuthEmail);
  resetFeedback();
}

async function postJson(url, payload) {
  const response = await apiFetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

async function finishSession(message, toast) {
  authDialog.close();
  authDialogForms.forEach((form) => form.reset());
  pendingAuthEmail = '';
  await refreshUser();
  if (window.pendingDonate) {
    toast.update(message, 'success');
    window.pendingDonate = false;
    donateDialog.showModal();
    return;
  }
  const requestedPath = new URLSearchParams(window.location.search).get('next');
  toast.dismiss();
  dashboard.notifyAfterNavigation(message);
  window.location.assign(safeReturnPath(requestedPath));
}

function showAuth() {
  setAuthMode('login');
  authDialog.showModal();
}

function startResendCooldown(seconds) {
  const button = document.querySelector('#otp-resend');
  let remaining = seconds;
  button.disabled = true;
  button.textContent = `Send a new code in ${remaining}s`;
  clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(resendTimer);
      button.disabled = false;
      button.textContent = 'Send a new code';
      return;
    }
    button.textContent = `Send a new code in ${remaining}s`;
  }, 1000);
}

function safeReturnPath(value) {
  if (!value) return '/dashboard.html';
  try {
    const destination = new URL(value, window.location.origin);
    if (destination.origin !== window.location.origin) return '/dashboard.html';
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return '/dashboard.html';
  }
}

async function refreshUser() {
  try {
    const response = await apiFetch('/api/auth/me');
    const data = await response.json();
    currentUser = data.user;
    document.querySelector('#auth-open').classList.toggle('d-none', Boolean(currentUser));
    document.querySelector('#signout-button').classList.toggle('d-none', !currentUser);
    document.querySelector('#dashboard-link').classList.toggle('d-none', !currentUser);
  } catch {
    currentUser = null;
  }
}

document.querySelectorAll('#auth-open').forEach((button) => button.addEventListener('click', showAuth));
document.querySelector('#auth-switch').addEventListener('click', () => setAuthMode(authMode === 'register' ? 'login' : 'register'));
document.querySelector('#forgot-switch').addEventListener('click', () => setAuthMode('forgot', { email: authForms.credentials.elements.email.value.trim() || pendingAuthEmail }));
document.querySelectorAll('[data-auth-back]').forEach((button) => button.addEventListener('click', () => setAuthMode('login', { email: pendingAuthEmail })));
document.querySelector('#auth-form [name="studentId"]').addEventListener('input', (event) => {
  event.currentTarget.value = event.currentTarget.value.toUpperCase();
});

authForms.credentials.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const feedback = document.querySelector('#auth-feedback');
  const button = document.querySelector('#auth-submit');
  const copy = authCopy[authMode];
  feedback.textContent = '';
  dashboard.setBusy(button, true, copy.action);
  const toast = dashboard.notify(copy.action, 'loading', 0);

  try {
    if (authMode === 'register') {
      const data = await postJson('/api/auth/register', payload);
      toast.dismiss();
      setAuthMode('verify', { email: data.email || payload.email });
      const otpFeedback = document.querySelector('#otp-feedback');
      otpFeedback.className = 'form-feedback success-message';
      otpFeedback.textContent = data.message || 'Verification code sent. Check your inbox.';
      dashboard.notify('Verification code sent. Check your inbox.', 'success');
      authForms.verify.elements.code.focus();
      return;
    }
    await postJson('/api/auth/login', payload);
    await finishSession('Signed in successfully.', toast);
  } catch (error) {
    feedback.textContent = error.message;
    if (!authDialog.open) authDialog.showModal();
    toast.update(error.message, 'error', 6000);
  } finally {
    dashboard.setBusy(button, false);
  }
});

authForms.verify.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = document.querySelector('#otp-feedback');
  const button = document.querySelector('#otp-submit');
  feedback.textContent = '';
  dashboard.setBusy(button, true, 'Verifying…');
  const toast = dashboard.notify('Verifying your email…', 'loading', 0);
  try {
    await postJson('/api/auth/verify-email', { email: pendingAuthEmail, code: form.elements.code.value.trim() });
    await finishSession('Account created. You’re signed in.', toast);
  } catch (error) {
    feedback.textContent = error.message;
    toast.update(error.message, 'error', 6000);
    form.elements.code.select();
  } finally {
    dashboard.setBusy(button, false);
  }
});

document.querySelector('#otp-resend').addEventListener('click', async () => {
  const button = document.querySelector('#otp-resend');
  const feedback = document.querySelector('#otp-feedback');
  feedback.textContent = '';
  button.disabled = true;
  const idleLabel = button.textContent;
  button.textContent = 'Sending…';
  try {
    const data = await postJson('/api/auth/resend-code', { email: pendingAuthEmail });
    feedback.className = 'form-feedback success-message';
    feedback.textContent = data.message || 'A new verification code was sent.';
    startResendCooldown(60);
  } catch (error) {
    feedback.textContent = error.message;
    button.disabled = false;
    button.textContent = idleLabel;
  }
});

authForms.forgot.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = authForms.forgot.elements.email.value.trim();
  const feedback = document.querySelector('#forgot-feedback');
  const button = authForms.forgot.querySelector('button[type="submit"]');
  feedback.textContent = '';
  dashboard.setBusy(button, true, 'Sending code…');
  const toast = dashboard.notify('Sending your reset code…', 'loading', 0);
  try {
    const data = await postJson('/api/auth/forgot-password', { email });
    setAuthMode('reset', { email });
    const resetFeedback = document.querySelector('#reset-feedback');
    resetFeedback.className = 'form-feedback success-message';
    resetFeedback.textContent = data.message || 'If a verified account matches that email, a reset code is on its way.';
    toast.dismiss();
    dashboard.notify(resetFeedback.textContent, 'success');
    authForms.reset.elements.code.focus();
  } catch (error) {
    feedback.textContent = error.message;
    toast.update(error.message, 'error', 6000);
  } finally {
    dashboard.setBusy(button, false);
  }
});

authForms.reset.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = document.querySelector('#reset-feedback');
  const button = form.querySelector('button[type="submit"]');
  feedback.textContent = '';
  dashboard.setBusy(button, true, 'Resetting password…');
  const toast = dashboard.notify('Resetting your password…', 'loading', 0);
  try {
    const data = await postJson('/api/auth/reset-password', {
      email: pendingAuthEmail,
      code: form.elements.code.value.trim(),
      password: form.elements.password.value
    });
    setAuthMode('login', { email: pendingAuthEmail });
    toast.dismiss();
    dashboard.notify(data.message || 'Password reset. You can now sign in.', 'success');
  } catch (error) {
    feedback.textContent = error.message;
    toast.update(error.message, 'error', 6000);
    form.elements.code.select();
  } finally {
    dashboard.setBusy(button, false);
  }
});

document.querySelector('#signout-button').addEventListener('click', async () => {
  const button = document.querySelector('#signout-button');
  dashboard.setBusy(button, true, 'Signing out…');
  const toast = dashboard.notify('Signing out…', 'loading', 0);
  try {
    const response = await apiFetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Could not sign out. Try again.');
    toast.dismiss();
    dashboard.notifyAfterNavigation('Signed out.');
    window.location.assign('/');
  } catch (error) {
    toast.update(error.message, 'error');
    dashboard.setBusy(button, false);
  }
});

function openDonate() {
  if (!currentUser) {
    window.pendingDonate = true;
    dashboard.notify('Sign in to offer an item.', 'info');
    showAuth();
    return;
  }
  donateDialog.showModal();
}

['#donate-open', '#donate-open-bottom', '#mobile-donate'].forEach((selector) => {
  document.querySelector(selector).addEventListener('click', openDonate);
});
const donatePicker = dashboard.imagePicker(
  document.querySelector('#donate-form [name="images"]'),
  document.querySelector('#donate-preview'),
  { onReject: (message) => dashboard.notify(message, 'error') }
);

document.querySelector('#donate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const files = donatePicker.files;
  const feedback = document.querySelector('#donate-feedback');
  feedback.textContent = '';
  if (files.length < 1 || files.length > 5 || files.some((file) => file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
    feedback.textContent = 'Choose 1–5 JPEG, PNG, or WebP images, each no larger than 5 MB.';
    dashboard.notify(feedback.textContent, 'error');
    return;
  }

  const button = form.querySelector('button[type="submit"]');
  dashboard.setBusy(button, true, 'Uploading photos…');
  const toast = dashboard.notify('Uploading photos and sending for review…', 'loading', 0);
  try {
    const response = await apiFetch('/api/items', {
      method: 'POST', body: dashboard.formDataWithImages(form, files)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to submit this listing.');
    form.reset();
    donatePicker.reset();
    donateDialog.close();
    toast.update('Listing sent for review.', 'success');
  } catch (error) {
    feedback.textContent = error.message;
    toast.update(error.message, 'error', 6000);
  } finally {
    dashboard.setBusy(button, false);
  }
});

categories.addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  activeCategory = button.dataset.category;
  categories.querySelectorAll('.category-pill').forEach((pill) => pill.classList.toggle('active', pill === button));
  loadListings();
});

if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadListings, 250);
  });
}

refreshUser();
loadListings();
if (new URLSearchParams(window.location.search).get('auth') === '1') showAuth();