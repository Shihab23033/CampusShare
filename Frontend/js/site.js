window.CampusShare = (() => {
  function getToastHost() {
    let host = document.querySelector('#toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      host.className = 'toast-host';
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('aria-relevant', 'additions text');
      document.body.append(host);
    }
    return host;
  }

  function notify(message, type = 'info', duration = 4200) {
    const toast = document.createElement('div');
    toast.className = `app-toast toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'toast-text';
    toast.append(icon, text);
    getToastHost().append(toast);

    let timer;
    function setContent(nextMessage, nextType, nextDuration) {
      toast.className = `app-toast toast-${nextType}`;
      toast.setAttribute('role', nextType === 'error' ? 'alert' : 'status');
      icon.textContent = nextType === 'success' ? '✓' : nextType === 'error' ? '!' : '';
      text.textContent = nextMessage;
      window.clearTimeout(timer);
      if (nextDuration > 0) timer = window.setTimeout(dismiss, nextDuration);
    }
    function dismiss() {
      window.clearTimeout(timer);
      toast.classList.add('toast-leaving');
      window.setTimeout(() => toast.remove(), 180);
    }

    setContent(message, type, duration);
    return {
      update(nextMessage, nextType = 'info', nextDuration = 4200) {
        setContent(nextMessage, nextType, nextDuration);
      },
      dismiss
    };
  }

  function notifyAfterNavigation(message, type = 'success') {
    try {
      sessionStorage.setItem('campusshare.toast', JSON.stringify({ message, type }));
    } catch {}
  }

  function showPendingToast() {
    try {
      const value = sessionStorage.getItem('campusshare.toast');
      if (!value) return;
      sessionStorage.removeItem('campusshare.toast');
      const pending = JSON.parse(value);
      if (pending.message) notify(pending.message, pending.type || 'success');
    } catch {}
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent;
      button.disabled = true;
      if (busyLabel) button.textContent = busyLabel;
    } else {
      button.disabled = false;
      if (button.dataset.idleLabel) {
        button.textContent = button.dataset.idleLabel;
        delete button.dataset.idleLabel;
      }
    }
  }

  function clearPreview(container) {
    if (!container) return;
    (container.objectUrls || []).forEach((url) => URL.revokeObjectURL(url));
    container.objectUrls = [];
    container.replaceChildren();
    container.hidden = true;
  }

  function previewFiles(input, container) {
    clearPreview(container);
    const files = [...(input.files || [])];
    if (!files.length) return;
    container.hidden = false;
    for (const [index, file] of files.entries()) {
      const url = URL.createObjectURL(file);
      container.objectUrls.push(url);
      const figure = document.createElement('figure');
      figure.className = 'image-preview';
      const image = document.createElement('img');
      image.src = url;
      image.alt = `Selected photo ${index + 1}`;
      const caption = document.createElement('figcaption');
      caption.textContent = file.name;
      figure.append(image, caption);
      container.append(figure);
    }
  }

  const acceptedPhotoTypes = ['image/jpeg', 'image/png', 'image/webp'];

  function imagePicker(input, container, options = {}) {
    const max = options.max || 5;
    const maxBytes = options.maxBytes || 5 * 1024 * 1024;
    const types = options.types || acceptedPhotoTypes;
    const onReject = options.onReject || (() => {});
    const onCoverChange = options.onCoverChange || (() => {});
    const files = [];

    function render() {
      clearPreview(container);
      if (!files.length) return;
      container.hidden = false;
      files.forEach((file, index) => {
        const url = URL.createObjectURL(file);
        container.objectUrls.push(url);
        const figure = document.createElement('figure');
        figure.className = `image-preview${index === 0 ? ' is-cover' : ''}`;
        figure.dataset.pickIndex = String(index);
        figure.tabIndex = 0;
        figure.setAttribute('role', 'button');
        figure.setAttribute('aria-label', index === 0 ? 'Cover photo' : `Make ${file.name} the cover photo`);
        const image = document.createElement('img');
        image.src = url;
        image.alt = '';
        const chip = document.createElement('span');
        chip.className = 'cover-chip';
        chip.textContent = index === 0 ? 'Cover' : 'Make cover';
        const caption = document.createElement('figcaption');
        caption.textContent = file.name;
        figure.append(image, chip, caption);
        container.append(figure);
      });
    }

    function select(index) {
      if (!Number.isInteger(index) || index === 0 || index < 0 || index >= files.length) return;
      const [moved] = files.splice(index, 1);
      files.unshift(moved);
      render();
      onCoverChange(files[0]);
    }

    function add(fileList) {
      const incoming = [...(fileList || [])];
      if (!incoming.length) return;
      for (const file of incoming) {
        if (files.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) continue;
        if (!types.includes(file.type) || file.size > maxBytes) {
          onReject('Use JPEG, PNG, or WebP photos, each no larger than 5 MB.');
          continue;
        }
        if (files.length >= max) {
          onReject(`Choose up to ${max} photos.`);
          break;
        }
        files.push(file);
      }
      render();
    }

    function activate(event) {
      const figure = event.target && event.target.closest ? event.target.closest('figure[data-pick-index]') : null;
      if (!figure || !container.contains(figure)) return;
      select(Number(figure.dataset.pickIndex));
    }

    input.addEventListener('change', () => {
      add(input.files);
      input.value = '';
    });
    container.addEventListener('click', activate);
    container.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate(event);
    });

    return {
      add,
      get files() { return files.slice(); },
      get count() { return files.length; },
      reset() { files.length = 0; clearPreview(container); }
    };
  }

  function formDataWithImages(form, files, inputName = 'images') {
    const data = new FormData();
    for (const element of form.elements) {
      if (!element.name || element.name === inputName || element.type === 'file') continue;
      if ((element.type === 'checkbox' || element.type === 'radio') && !element.checked) continue;
      data.append(element.name, element.value);
    }
    for (const file of files) data.append(inputName, file, file.name);
    return data;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function apiBase() {
    const configured = window.CampusShareConfig && window.CampusShareConfig.apiBase;
    return String(configured || '').trim().replace(/\/+$/, '');
  }

  function apiUrl(path) {
    const suffix = String(path || '');
    return `${apiBase()}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
  }

  async function api(url, options = {}) {
    const response = await fetch(apiUrl(url), { credentials: 'include', ...options });
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'Something went wrong. Please try again.');
    return data;
  }

  async function loadUser() {
    return (await api('/api/auth/me')).user;
  }

  function authRedirect() {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/?auth=1&next=${encodeURIComponent(next)}`);
  }

  async function requireStudent() {
    try {
      const user = await loadUser();
      if (!user) {
        authRedirect();
        return null;
      }
      if (user.role !== 'student') {
        window.location.replace('/admin.html');
        return null;
      }
      bindShell(user);
      return user;
    } catch (error) {
      showNotice(error.message);
      return null;
    }
  }

  async function requireAdmin() {
    try {
      const user = await loadUser();
      if (!user) {
        authRedirect();
        return null;
      }
      bindShell(user);
      if (user.role !== 'admin') {
        showNotice('Your account does not have administrator access.');
        return null;
      }
      return user;
    } catch (error) {
      showNotice(error.message);
      return null;
    }
  }

  function bindShell(user) {
    document.querySelectorAll('[data-user-name]').forEach((node) => { node.textContent = user.name; });
    document.querySelectorAll('[data-admin-link]').forEach((node) => { node.hidden = user.role !== 'admin'; });
    document.querySelectorAll('[data-signout]').forEach((button) => {
      button.addEventListener('click', async () => {
        setBusy(button, true, 'Signing out…');
        const toast = notify('Signing out…', 'loading', 0);
        try {
          await api('/api/auth/logout', { method: 'POST' });
          toast.dismiss();
          notifyAfterNavigation('Signed out.');
          window.location.assign('/');
        } catch (error) {
          setBusy(button, false);
          toast.update(error.message, 'error', 6000);
        }
      });
    });
  }

  function showNotice(message, target = document.querySelector('[data-page-notice]')) {
    if (!target) return;
    target.textContent = message;
    target.hidden = !message;
  }

  function badgeForPoints(points) {
    if (points >= 10) return 'Community Hero';
    if (points >= 3) return 'Kind Neighbor';
    return 'New Giver';
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
  }

  showPendingToast();

  return { api, apiBase, apiUrl, authRedirect, badgeForPoints, clearPreview, escapeHtml, formatDate, formDataWithImages, imagePicker, loadUser, notify, notifyAfterNavigation, previewFiles, requireAdmin, requireStudent, setBusy, showNotice };
})();