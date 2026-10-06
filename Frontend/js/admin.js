const adminApp = window.CampusShare;
const moderationList = document.querySelector('#moderation-list');
const usersList = document.querySelector('#users-list');
const statusLabels = { pending: 'Pending review', approved: 'Available', rejected: 'Rejected', donated: 'Donated' };
let selectedStatus = 'all';
let listingSearchTimer;
let userSearchTimer;
let listingRequestId = 0;
let userRequestId = 0;
let statusChart;
let recipientsChart;

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function renderAnalytics(data) {
  const stats = data.stats;
  document.querySelector('#metric-total-items').textContent = numeric(stats.totalItems).toLocaleString();
  document.querySelector('#metric-pending').textContent = numeric(stats.pendingItems).toLocaleString();
  document.querySelector('#metric-available').textContent = numeric(stats.availableItems).toLocaleString();
  document.querySelector('#metric-rejected').textContent = numeric(stats.rejectedItems).toLocaleString();
  document.querySelector('#metric-users').textContent = numeric(stats.totalUsers).toLocaleString();
  document.querySelector('#metric-banned').textContent = `${numeric(stats.bannedUsers).toLocaleString()} banned`;
  document.querySelector('#metric-received').textContent = numeric(stats.successfullyReceived).toLocaleString();

  if (!window.Chart) {
    adminApp.showNotice('Charts could not load. Check the connection and refresh.');
    return;
  }

  statusChart?.destroy();
  recipientsChart?.destroy();
  statusChart = new Chart(document.querySelector('#status-chart'), {
    type: 'doughnut',
    data: {
      labels: ['Pending review', 'Available', 'Rejected', 'Donated'],
      datasets: [{
        data: [stats.pendingItems, stats.availableItems, stats.rejectedItems, stats.donatedItems].map(numeric),
        backgroundColor: ['#e9ad3f', '#087b58', '#ad4338', '#929a93'],
        borderColor: '#ffffff',
        borderWidth: 3,
        hoverOffset: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '64%',
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 15, font: { family: 'DM Sans', size: 11 } } } }
    }
  });

  const recipients = data.topRecipients || [];
  recipientsChart = new Chart(document.querySelector('#recipients-chart'), {
    type: 'bar',
    data: {
      labels: recipients.length ? recipients.map((user) => user.name) : ['No received items yet'],
      datasets: [{
        label: 'Items received',
        data: recipients.length ? recipients.map((user) => numeric(user.received_count)) : [0],
        backgroundColor: '#087b58',
        borderRadius: 3,
        maxBarThickness: 25
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#edf0ec' } },
        y: { grid: { display: false }, ticks: { font: { family: 'DM Sans', size: 10 } } }
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `${context.raw} received` } } }
    }
  });
}

function renderQueue(items) {
  document.querySelector('#listing-count').textContent = `${items.length} ${items.length === 1 ? 'listing' : 'listings'}`;
  if (!items.length) {
    moderationList.innerHTML = '<div class="empty-state">No listings match this filter.</div>';
    return;
  }
  moderationList.innerHTML = items.map((item) => `
    <article class="moderation-row" data-item-id="${item.id}">
      ${item.image_url ? `<img src="${adminApp.escapeHtml(item.image_url)}" alt="Photo of ${adminApp.escapeHtml(item.title)}">` : '<div class="manage-image">No photo</div>'}
      <div><p class="eyebrow">${adminApp.escapeHtml(item.category)} · Submitted ${adminApp.formatDate(item.created_at)}</p>
        <h3>${adminApp.escapeHtml(item.title)}</h3><p>${adminApp.escapeHtml(item.description)}</p>
        <p>Submitted by ${adminApp.escapeHtml(item.donor_name)} · ${adminApp.escapeHtml(item.donor_email)}${item.donor_banned ? ' · Account banned' : ''}</p>
        <div class="moderation-status-line"><span class="status-tag status-${adminApp.escapeHtml(item.status)}">${statusLabels[item.status] || adminApp.escapeHtml(item.status)}</span>
        ${item.status === 'pending' ? `<div class="moderation-actions"><button class="btn btn-share approve-item" data-id="${item.id}" type="button">Approve listing</button><button class="btn btn-share btn-reject reject-item" data-id="${item.id}" type="button">Reject</button></div>` : ''}</div>
      </div>
    </article>`).join('');
  moderationList.querySelectorAll('.approve-item').forEach((button) => button.addEventListener('click', () => moderate(button, 'approve')));
  moderationList.querySelectorAll('.reject-item').forEach((button) => button.addEventListener('click', () => moderate(button, 'reject')));
}

async function loadAnalytics() {
  const data = await adminApp.api('/api/admin/analytics');
  renderAnalytics(data);
}

async function loadListings() {
  const requestId = ++listingRequestId;
  const params = new URLSearchParams({ status: selectedStatus });
  const search = document.querySelector('#listing-search').value.trim();
  if (search) params.set('search', search);
  try {
    const data = await adminApp.api(`/api/admin/items?${params}`);
    if (requestId !== listingRequestId) return;
    renderQueue(data.items);
  } catch (error) {
    if (requestId !== listingRequestId) return;
    adminApp.showNotice(error.message);
    moderationList.innerHTML = '';
  }
}

function renderUsers(users) {
  document.querySelector('#users-count').textContent = `${users.length} ${users.length === 1 ? 'student' : 'students'}`;
  if (!users.length) {
    usersList.innerHTML = '<tr><td colspan="5" class="empty-state">No students match this filter.</td></tr>';
    return;
  }
  usersList.innerHTML = users.map((user) => `
    <tr>
      <td><strong>${adminApp.escapeHtml(user.name)}</strong><small>${adminApp.escapeHtml(user.email)}</small></td>
      <td>${numeric(user.received_count)}</td>
      <td>${numeric(user.doner_points)}</td>
      <td><span class="status-tag ${user.is_banned ? 'status-rejected' : 'status-approved'}">${user.is_banned ? 'Banned' : 'Active'}</span></td>
      <td><button class="quiet-button user-ban-toggle" data-user-id="${user.id}" data-banned="${Boolean(user.is_banned)}" type="button">${user.is_banned ? 'Unban' : 'Ban'}</button></td>
    </tr>`).join('');
  usersList.querySelectorAll('.user-ban-toggle').forEach((button) => button.addEventListener('click', toggleUserBan));
}

async function loadUsers() {
  const requestId = ++userRequestId;
  const params = new URLSearchParams({ banned: document.querySelector('#user-status-filter').value });
  const search = document.querySelector('#user-search').value.trim();
  if (search) params.set('search', search);
  try {
    const data = await adminApp.api(`/api/admin/users?${params}`);
    if (requestId !== userRequestId) return;
    renderUsers(data.users);
  } catch (error) {
    if (requestId !== userRequestId) return;
    adminApp.showNotice(error.message);
    usersList.innerHTML = '<tr><td colspan="5" class="empty-state">Could not load students.</td></tr>';
  }
}

async function refreshDashboard() {
  const toast = adminApp.notify('Refreshing admin dashboard…', 'loading', 0);
  try {
    await Promise.all([loadAnalytics(), loadListings(), loadUsers()]);
    adminApp.showNotice('');
    toast.update('Dashboard refreshed.', 'success', 1800);
  } catch (error) {
    adminApp.showNotice(error.message);
    toast.update(error.message, 'error', 6000);
  }
}

async function moderate(button, action) {
  const itemId = button.dataset.id;
  if (action === 'reject' && !window.confirm('Reject this listing? It will not appear in the public feed.')) return;
  adminApp.setBusy(button, true, action === 'approve' ? 'Approving…' : 'Rejecting…');
  const toast = adminApp.notify(action === 'approve' ? 'Approving listing…' : 'Rejecting listing…', 'loading', 0);
  try {
    await adminApp.api(`/api/admin/${action}/${itemId}`, { method: 'PUT' });
    toast.update(action === 'approve' ? 'Listing approved.' : 'Listing rejected.', 'success');
    await Promise.all([loadAnalytics(), loadListings()]);
  } catch (error) {
    adminApp.setBusy(button, false);
    toast.update(error.message, 'error', 6000);
    adminApp.showNotice(error.message);
  }
}

async function toggleUserBan(event) {
  const button = event.currentTarget;
  const banned = button.dataset.banned !== 'true';
  const name = button.closest('tr').querySelector('strong').textContent;
  const message = banned
    ? `Ban ${name}? Their active listings will be rejected and pending requests declined. Unbanning will not republish those listings.`
    : `Unban ${name}? Their rejected listings will remain offline until edited and approved.`;
  if (!window.confirm(message)) return;

  adminApp.setBusy(button, true, banned ? 'Banning…' : 'Unbanning…');
  const toast = adminApp.notify(banned ? 'Banning student…' : 'Unbanning student…', 'loading', 0);
  try {
    await adminApp.api(`/api/admin/users/${button.dataset.userId}/ban`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ banned })
    });
    toast.update(banned ? 'Student banned; active listings and pending requests closed.' : 'Student unbanned.', 'success', 5000);
    await Promise.all([loadAnalytics(), loadListings(), loadUsers()]);
  } catch (error) {
    adminApp.setBusy(button, false);
    toast.update(error.message, 'error', 6000);
  }
}

document.querySelector('#refresh-dashboard').addEventListener('click', refreshDashboard);
document.querySelectorAll('.admin-status-tab').forEach((button) => button.addEventListener('click', () => {
  selectedStatus = button.dataset.status;
  document.querySelectorAll('.admin-status-tab').forEach((tab) => {
    const active = tab === button;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
  loadListings();
}));
document.querySelector('#listing-search').addEventListener('input', () => {
  window.clearTimeout(listingSearchTimer);
  listingSearchTimer = window.setTimeout(loadListings, 220);
});
document.querySelector('#user-search').addEventListener('input', () => {
  window.clearTimeout(userSearchTimer);
  userSearchTimer = window.setTimeout(loadUsers, 220);
});
document.querySelector('#user-status-filter').addEventListener('change', loadUsers);
(async () => {
  if (await adminApp.requireAdmin()) {
    try {
      await Promise.all([loadAnalytics(), loadListings(), loadUsers()]);
    } catch (error) {
      adminApp.showNotice(error.message);
    }
  }
})();