const publicProfileApp = window.CampusShare;
const profileId = new URLSearchParams(window.location.search).get('id');
const publicProfile = document.querySelector('#public-profile');

(async () => {
  if (!profileId || !/^\d+$/.test(profileId)) {
    publicProfile.innerHTML = '';
    publicProfileApp.showNotice('This profile link is not valid.');
    return;
  }
  try {
    const [data, user] = await Promise.all([
      publicProfileApp.api(`/api/user/${encodeURIComponent(profileId)}`),
      publicProfileApp.loadUser().catch(() => null)
    ]);
    const profile = data.profile;
    document.title = `${profile.name} | CampusShare`;
    publicProfile.innerHTML = `
      <div class="public-profile-header"><span class="public-avatar-fallback">${publicProfileApp.escapeHtml(profile.name.slice(0, 1).toUpperCase())}</span><img class="public-avatar" src="${publicProfileApp.escapeHtml(profile.profile_pic_url || '')}" alt="${publicProfileApp.escapeHtml(profile.name)}’s profile photo"><div><p class="eyebrow">CAMPUSSHARE MEMBER</p><h1>${publicProfileApp.escapeHtml(profile.name)}</h1><p class="public-profile-stat">${publicProfileApp.badgeForPoints(profile.doner_points)} · ${profile.donated_count} items passed on</p></div></div>
      <p class="public-profile-bio">${publicProfileApp.escapeHtml(profile.bio || 'This student has not added a bio yet.')}</p>
      <p class="public-profile-stat">Member since ${publicProfileApp.formatDate(profile.created_at)}</p>`;
    const avatar = publicProfile.querySelector('.public-avatar');
    const avatarFallback = publicProfile.querySelector('.public-avatar-fallback');
    avatar.onerror = () => { avatar.hidden = true; avatarFallback.hidden = false; };
    avatarFallback.hidden = Boolean(profile.profile_pic_url);
    if (user) {
      document.querySelectorAll('[data-user-name]').forEach((node) => { node.textContent = user.name; });
      document.querySelectorAll('[data-signout]').forEach((button) => {
        button.hidden = false;
        button.addEventListener('click', async () => {
          publicProfileApp.setBusy(button, true, 'Signing out…');
          const toast = publicProfileApp.notify('Signing out…', 'loading', 0);
          try {
            await publicProfileApp.api('/api/auth/logout', { method: 'POST' });
            toast.update('Signed out.', 'success', 1500);
            window.setTimeout(() => window.location.assign('/'), 250);
          } catch (error) {
            publicProfileApp.setBusy(button, false);
            toast.update(error.message, 'error', 6000);
          }
        });
      });
    }
  } catch (error) {
    publicProfile.innerHTML = '';
    publicProfileApp.showNotice(error.message);
  }
})();