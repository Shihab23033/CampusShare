const profileApp = window.CampusShare;
const profileForm = document.querySelector('#profile-form');
let profileUser;

function renderProfile(profile) {
  profileForm.elements.name.value = profile.name || '';
  profileForm.elements.email.value = profile.email || '';
  profileForm.elements.phone.value = profile.phone || '';
  profileForm.elements.bio.value = profile.bio || '';
    profileForm.elements.department.value = profile.department || '';
    profileForm.elements.studentId.value = profile.student_id || '';
  document.querySelector('#profile-name-display').textContent = profile.name || 'Student';
  document.querySelector('#profile-email-display').textContent = profile.email || '';
  document.querySelector('#profile-points').textContent = profile.doner_points || 0;
  document.querySelector('#profile-badge').textContent = profileApp.badgeForPoints(profile.doner_points || 0);
  const avatar = document.querySelector('#profile-avatar');
  const fallback = document.querySelector('#avatar-fallback');
  fallback.textContent = (profile.name || 'S').slice(0, 1).toUpperCase();
  avatar.hidden = false;
  fallback.hidden = true;
  avatar.onerror = () => {
    avatar.hidden = true;
    fallback.hidden = false;
  };
  if (profile.profile_pic_url) avatar.src = profile.profile_pic_url;
}

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const feedback = document.querySelector('#profile-feedback');
  feedback.textContent = '';
  const button = profileForm.querySelector('button[type="submit"]');
  profileApp.setBusy(button, true, 'Saving…');
  const toast = profileApp.notify('Saving profile…', 'loading', 0);
  try {
    const data = await profileApp.api('/api/user/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: profileForm.elements.name.value,
        phone: profileForm.elements.phone.value,
        department: profileForm.elements.department.value,
        bio: profileForm.elements.bio.value
      })
    });
    renderProfile({ ...profileUser, ...data.profile });
    feedback.className = 'form-feedback success-message';
    feedback.textContent = 'Profile saved.';
    toast.update('Profile saved.', 'success');
  } catch (error) {
    feedback.textContent = error.message;
    toast.update(error.message, 'error', 6000);
  } finally {
    profileApp.setBusy(button, false);
  }
});

document.querySelector('#avatar-input').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const feedback = document.querySelector('#profile-feedback');
  feedback.textContent = '';
  if (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    feedback.textContent = 'Choose a JPEG, PNG, or WebP image smaller than 5 MB.';
    profileApp.notify(feedback.textContent, 'error');
    event.target.value = '';
    return;
  }

  const avatar = document.querySelector('#profile-avatar');
  const fallback = document.querySelector('#avatar-fallback');
  const previewUrl = URL.createObjectURL(file);
  avatar.src = previewUrl;
  avatar.hidden = false;
  fallback.hidden = true;
  const formData = new FormData();
  formData.append('avatar', file);
  event.target.disabled = true;
  const toast = profileApp.notify('Uploading profile photo…', 'loading', 0);
  try {
    const data = await profileApp.api('/api/user/avatar', { method: 'POST', body: formData });
    URL.revokeObjectURL(previewUrl);
    avatar.src = data.profilePicUrl;
    profileUser.profile_pic_url = data.profilePicUrl;
    toast.update('Profile photo updated.', 'success');
  } catch (error) {
    feedback.textContent = error.message;
    avatar.src = profileUser.profile_pic_url || '';
    toast.update(error.message, 'error', 6000);
  } finally {
    event.target.disabled = false;
    event.target.value = '';
    URL.revokeObjectURL(previewUrl);
  }
});

(async () => {
  profileUser = await profileApp.requireStudent();
  if (!profileUser) return;
  try {
    const data = await profileApp.api('/api/user/profile');
    renderProfile(data.profile);
  } catch (error) {
    profileApp.showNotice(error.message);
  }
})();