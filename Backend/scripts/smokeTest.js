require('dotenv').config();

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { deleteImage } = require('../config/cloudinary');

const baseUrl = process.env.TEST_BASE_URL || `http://127.0.0.1:${process.env.TEST_PORT || 3012}`;
const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const password = 'CampusShare-Smoke-Test-2026';
const identities = [];
const sessionIds = [];
let testItemId;
let pendingApproveId;
let pendingRejectId;
let approvedModerationId;
let bannedItemId;
const cloudinaryPublicIds = [];
let handoffCompleted = false;
let donorId;

async function call(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body && !isFormData && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? (isFormData ? options.body : headers['Content-Type'] === 'application/json' ? JSON.stringify(options.body) : options.body) : undefined
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  return { response, data };
}

function cloudinaryIdFromUrl(url) {
  const path = new URL(url).pathname.split('/upload/')[1];
  return decodeURIComponent(path.replace(/^v\d+\//, '').replace(/\.[^.]+$/, ''));
}

function rememberSession(response) {
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  if (cookie) {
    const signedValue = decodeURIComponent(cookie.slice('campusshare.sid='.length));
    sessionIds.push(signedValue.replace(/^s:/, '').split('.')[0]);
  }
  return cookie;
}

async function register(label) {
  const email = `smoke-${label}-${suffix}@campusshare.test`;
  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await db.execute(
    `INSERT INTO users (name, email, password, department, student_id, email_verified_at)
     VALUES (?, ?, ?, 'Testing', ?, UTC_TIMESTAMP())`,
    [`Smoke ${label}`, email, passwordHash, `SMOKE-${label.toUpperCase()}-${suffix}`.slice(0, 50)]
  );
  identities.push(result.insertId);
  const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(login.response.status, 200, `login ${label}`);
  return {
    user: { id: result.insertId, email, name: `Smoke ${label}` },
    cookie: rememberSession(login.response)
  };
}

async function run() {
  const health = await call('/api/health');
  assert.equal(health.response.status, 200, 'server health');

  const noSessionListings = await call('/api/items/mine');
  assert.equal(noSessionListings.response.status, 401, 'private listings require sign-in');

  const invalidEmail = await call('/api/auth/register', {
    method: 'POST', body: { name: 'Invalid', email: 'not-an-email', password }
  });
  assert.equal(invalidEmail.response.status, 400, 'invalid email rejected');

  const missingIdentity = await call('/api/auth/register', {
    method: 'POST', body: { name: 'No identity', email: `smoke-missing-${suffix}@campusshare.test`, password }
  });
  assert.equal(missingIdentity.response.status, 400, 'department and student ID are required at signup');

  const unknownCode = await call('/api/auth/verify-email', {
    method: 'POST', body: { email: `smoke-nocode-${suffix}@campusshare.test`, code: '123456' }
  });
  assert.equal(unknownCode.response.status, 400, 'verification without a pending signup is rejected');

  const unknownResend = await call('/api/auth/resend-code', {
    method: 'POST', body: { email: `smoke-noresend-${suffix}@campusshare.test` }
  });
  assert.equal(unknownResend.response.status, 404, 'resend without a pending signup is rejected');

  const unknownForgot = await call('/api/auth/forgot-password', {
    method: 'POST', body: { email: `smoke-noforgot-${suffix}@campusshare.test` }
  });
  assert.equal(unknownForgot.response.status, 202, 'password reset never reveals whether an account exists');

  const wrongResetCode = await call('/api/auth/reset-password', {
    method: 'POST', body: { email: `smoke-noforgot-${suffix}@campusshare.test`, code: '000000', password }
  });
  assert.equal(wrongResetCode.response.status, 400, 'password reset requires a valid code');

  const donor = await register('donor');
  const requester = await register('requester');
  const competingRequester = await register('competing');
  const admin = await register('admin');
  donorId = donor.user.id;

  const profile = await call('/api/user/profile', { cookie: requester.cookie });
  assert.equal(profile.response.status, 200, 'student can view their private profile');
  const invalidPhone = await call('/api/user/profile', {
    method: 'PUT', cookie: requester.cookie,
    body: { name: 'Smoke requester', department: 'Testing', phone: 'call-me', bio: 'Test profile.' }
  });
  assert.equal(invalidPhone.response.status, 400, 'invalid phone is rejected');
  const savedProfile = await call('/api/user/profile', {
    method: 'PUT', cookie: requester.cookie,
    body: { name: 'Smoke requester updated', department: 'Computer Science', phone: '+1 (555) 010-2026', bio: 'Temporary profile test.' }
  });
  assert.equal(savedProfile.response.status, 200, 'valid profile updates are saved');

  const invalidAvatar = new FormData();
  invalidAvatar.append('avatar', new Blob(['not an image'], { type: 'application/pdf' }), 'file.pdf');
  const rejectedAvatar = await call('/api/user/avatar', { method: 'POST', cookie: requester.cookie, body: invalidAvatar });
  assert.equal(rejectedAvatar.response.status, 400, 'unsupported avatar type is rejected');
  const spoofedAvatar = new FormData();
  spoofedAvatar.append('avatar', new Blob(['not really a PNG'], { type: 'image/png' }), 'spoof.png');
  const rejectedSpoof = await call('/api/user/avatar', { method: 'POST', cookie: requester.cookie, body: spoofedAvatar });
  assert.equal(rejectedSpoof.response.status, 400, 'spoofed image MIME type is rejected by signature');

  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  const avatarForm = new FormData();
  avatarForm.append('avatar', new Blob([pixel], { type: 'image/png' }), 'smoke-avatar.png');
  const avatarUpload = await call('/api/user/avatar', { method: 'POST', cookie: requester.cookie, body: avatarForm });
  assert.equal(avatarUpload.response.status, 200, 'valid avatar uploads succeed');
  cloudinaryPublicIds.push(cloudinaryIdFromUrl(avatarUpload.data.profilePicUrl));

  const emptyListingForm = new FormData();
  emptyListingForm.append('title', `Missing photo listing ${suffix}`);
  emptyListingForm.append('category', 'Other');
  emptyListingForm.append('description', 'This listing has no photos and should be rejected.');
  const missingListingPhoto = await call('/api/items', { method: 'POST', cookie: donor.cookie, body: emptyListingForm });
  assert.equal(missingListingPhoto.response.status, 400, 'listing requires at least one photo');

  const listingForm = new FormData();
  listingForm.append('title', `Disposable uploaded listing ${suffix}`);
  listingForm.append('category', 'Other');
  listingForm.append('description', 'Temporary listing images uploaded during the API smoke test.');
  listingForm.append('images', new Blob([pixel], { type: 'image/png' }), 'smoke-cover-1.png');
  listingForm.append('images', new Blob([pixel], { type: 'image/png' }), 'smoke-cover-2.png');
  listingForm.append('images', new Blob([pixel], { type: 'image/png' }), 'smoke-cover-3.png');
  const createdListing = await call('/api/items', { method: 'POST', cookie: donor.cookie, body: listingForm });
  assert.equal(createdListing.response.status, 201, 'valid listing photo upload succeeds');
  pendingApproveId = createdListing.data.item.id;
  const [uploadedImages] = await db.execute(
    'SELECT id, image_url, is_cover FROM item_images WHERE item_id = ? ORDER BY id',
    [pendingApproveId]
  );
  assert.equal(uploadedImages.length, 3, 'multiple photos are stored against one listing');
  assert.equal(uploadedImages.filter((image) => image.is_cover === 1).length, 1, 'exactly one cover photo exists');
  assert.equal(uploadedImages[0].is_cover, 1, 'the first uploaded photo becomes the cover');
  uploadedImages.forEach((image) => cloudinaryPublicIds.push(cloudinaryIdFromUrl(image.image_url)));

  const secondCoverChange = await call(`/api/items/${pendingApproveId}/cover`, {
    method: 'PUT', cookie: donor.cookie, body: { imageId: uploadedImages[1].id }
  });
  assert.equal(secondCoverChange.response.status, 200, 'owner can pick another photo as the cover');
  const [coverRows] = await db.execute('SELECT id, is_cover FROM item_images WHERE item_id = ? ORDER BY id', [pendingApproveId]);
  assert.equal(coverRows.filter((row) => row.is_cover === 1).length, 1, 'changing the cover keeps exactly one cover');
  assert.equal(coverRows.find((row) => row.is_cover === 1).id, uploadedImages[1].id, 'the chosen photo is now the cover');

  const coverDetail = await call(`/api/items/${pendingApproveId}`, { cookie: donor.cookie });
  assert.equal(coverDetail.data.item.imageData[0].id, uploadedImages[1].id, 'cover photo is returned first with its id');
  assert.equal(coverDetail.data.item.imageData.filter((image) => image.isCover).length, 1, 'exactly one cover is flagged');
  assert.equal(coverDetail.data.item.images[0], uploadedImages[1].image_url, 'cover url leads the gallery order');

  const missingCoverPhoto = await call(`/api/items/${pendingApproveId}/cover`, {
    method: 'PUT', cookie: donor.cookie, body: { imageId: 99999999 }
  });
  assert.equal(missingCoverPhoto.response.status, 404, 'cover must belong to the listing');
  const foreignCoverChange = await call(`/api/items/${pendingApproveId}/cover`, {
    method: 'PUT', cookie: requester.cookie, body: { imageId: uploadedImages[0].id }
  });
  assert.equal(foreignCoverChange.response.status, 404, 'non-owner cannot change the cover photo');

  const hiddenPending = await call(`/api/items?search=${encodeURIComponent(`Disposable uploaded listing ${suffix}`)}`);
  assert.equal(hiddenPending.data.items.length, 0, 'pending uploaded listing is hidden from public feed');

  const forbiddenAdmin = await call('/api/admin/pending-items', { cookie: donor.cookie });
  assert.equal(forbiddenAdmin.response.status, 403, 'students cannot access moderation');

  await db.execute("UPDATE users SET role = 'admin' WHERE id = ?", [admin.user.id]);
  await call('/api/auth/logout', { method: 'POST', cookie: admin.cookie });
  const adminLogin = await call('/api/auth/login', {
    method: 'POST', body: { email: admin.user.email, password }
  });
  assert.equal(adminLogin.response.status, 200, 'admin can sign in after promotion');
  const adminCookie = rememberSession(adminLogin.response);

  const analytics = await call('/api/admin/analytics', { cookie: adminCookie });
  assert.equal(analytics.response.status, 200, 'admin analytics are available');
  assert.equal(
    Number(analytics.data.stats.totalItems),
    Number(analytics.data.stats.pendingItems) + Number(analytics.data.stats.availableItems) + Number(analytics.data.stats.rejectedItems) + Number(analytics.data.stats.donatedItems),
    'status totals add up to total items'
  );
  assert(Number.isFinite(Number(analytics.data.stats.totalUsers)), 'analytics includes total students');
  assert(Number.isFinite(Number(analytics.data.stats.successfullyReceived)), 'analytics includes accepted requests');

  const filteredItems = await call('/api/admin/items?status=pending', { cookie: adminCookie });
  assert.equal(filteredItems.response.status, 200, 'admin can filter listing status');
  assert(filteredItems.data.items.every((item) => item.status === 'pending'), 'status filter returns only pending items');
  const searchedUsers = await call(`/api/admin/users?search=${encodeURIComponent(requester.user.email)}`, { cookie: adminCookie });
  assert.equal(searchedUsers.response.status, 200, 'admin can search students');
  assert(searchedUsers.data.users.some((user) => Number(user.id) === Number(requester.user.id)), 'student search returns matching account');

  const [approveResult] = await db.execute(
    "INSERT INTO items (user_id, title, description, category, status) VALUES (?, ?, ?, 'Other', 'pending')",
    [donorId, `Disposable moderation approve ${suffix}`, 'Temporary pending listing for moderation test.']
  );
  approvedModerationId = approveResult.insertId;
  const [rejectResult] = await db.execute(
    "INSERT INTO items (user_id, title, description, category, status) VALUES (?, ?, ?, 'Other', 'pending')",
    [donorId, `Disposable moderation reject ${suffix}`, 'Temporary pending listing for moderation test.']
  );
  pendingRejectId = rejectResult.insertId;

  const pendingQueue = await call('/api/admin/pending-items', { cookie: adminCookie });
  assert.equal(pendingQueue.response.status, 200, 'admin can access the moderation queue');
  assert(pendingQueue.data.items.some((item) => Number(item.id) === approvedModerationId), 'queue includes pending listing');
  assert(pendingQueue.data.items.some((item) => Number(item.id) === pendingApproveId), 'queue includes uploaded listing');
  const queuedUpload = pendingQueue.data.items.find((item) => Number(item.id) === pendingApproveId);
  assert.equal(queuedUpload.image_url, uploadedImages[1].image_url, 'moderation queue shows the chosen cover photo');
  const approvedUploaded = await call(`/api/admin/approve/${pendingApproveId}`, { method: 'PUT', cookie: adminCookie });
  assert.equal(approvedUploaded.data.status, 'approved', 'admin can approve uploaded listing');

  const unauthorizedEditForm = new FormData();
  unauthorizedEditForm.append('title', 'Unauthorized edit');
  unauthorizedEditForm.append('category', 'Other');
  unauthorizedEditForm.append('description', 'A user must not edit somebody else listing.');
  unauthorizedEditForm.append('images', new Blob([pixel], { type: 'image/png' }), 'unauthorized.png');
  const unauthorizedEdit = await call(`/api/items/${pendingApproveId}`, { method: 'PUT', cookie: requester.cookie, body: unauthorizedEditForm });
  assert.equal(unauthorizedEdit.response.status, 404, 'non-owner cannot edit a listing');

  const editedTitle = `Disposable edited listing ${suffix}`;
  const textEditForm = new FormData();
  textEditForm.append('title', editedTitle);
  textEditForm.append('category', 'Other');
  textEditForm.append('description', 'Text-only edit keeps existing photos and returns to moderation.');
  const textEdit = await call(`/api/items/${pendingApproveId}`, { method: 'PUT', cookie: donor.cookie, body: textEditForm });
  assert.equal(textEdit.response.status, 200, 'owner can edit listing text without replacing photos');
  assert.equal(textEdit.data.item.status, 'pending', 'text edits return listing to pending review');
  assert.equal(textEdit.data.item.replacedPhotos, false, 'empty photo selection keeps existing photos');
  const hiddenEditedListing = await call(`/api/items?search=${encodeURIComponent(editedTitle)}`);
  assert.equal(hiddenEditedListing.data.items.length, 0, 'edited listing stays out of the feed before review');
  const [preservedImages] = await db.execute('SELECT image_url FROM item_images WHERE item_id = ?', [pendingApproveId]);
  assert.equal(preservedImages.length, 3, 'text edit preserves every current photo');

  const approvedTextEdit = await call(`/api/admin/approve/${pendingApproveId}`, { method: 'PUT', cookie: adminCookie });
  assert.equal(approvedTextEdit.data.status, 'approved', 'admin can reapprove an edited listing');
  const replacementForm = new FormData();
  replacementForm.append('title', editedTitle);
  replacementForm.append('category', 'Other');
  replacementForm.append('description', 'Replacement photo edit should return to moderation.');
  replacementForm.append('images', new Blob([pixel], { type: 'image/png' }), 'replacement.png');
  const photoEdit = await call(`/api/items/${pendingApproveId}`, { method: 'PUT', cookie: donor.cookie, body: replacementForm });
  assert.equal(photoEdit.response.status, 200, 'owner can replace listing photos');
  assert.equal(photoEdit.data.item.status, 'pending', 'photo replacement returns listing to pending review');
  assert.equal(photoEdit.data.item.replacedPhotos, true, 'photo replacement is reported');
  const [replacementImages] = await db.execute('SELECT image_url FROM item_images WHERE item_id = ?', [pendingApproveId]);
  assert.equal(replacementImages.length, 1, 'replacement photos replace the old image set');
  assert.notEqual(replacementImages[0].image_url, preservedImages[0].image_url, 'replacement photo URL changes');
  cloudinaryPublicIds.push(cloudinaryIdFromUrl(replacementImages[0].image_url));
  const hiddenReplacedListing = await call(`/api/items?search=${encodeURIComponent(editedTitle)}`);
  assert.equal(hiddenReplacedListing.data.items.length, 0, 'photo-edited listing remains hidden pending approval');
  const approvedPhotoEdit = await call(`/api/admin/approve/${pendingApproveId}`, { method: 'PUT', cookie: adminCookie });
  assert.equal(approvedPhotoEdit.data.status, 'approved', 'admin can approve replacement photos');
  const uploadedVisible = await call(`/api/items?search=${encodeURIComponent(editedTitle)}`);
  assert.equal(uploadedVisible.data.items.length, 1, 'reapproved edited listing appears in the feed');
  const approved = await call(`/api/admin/approve/${approvedModerationId}`, { method: 'PUT', cookie: adminCookie });
  assert.equal(approved.data.status, 'approved', 'admin can approve listing');
  const rejected = await call(`/api/admin/reject/${pendingRejectId}`, { method: 'PUT', cookie: adminCookie });
  assert.equal(rejected.data.status, 'rejected', 'admin can reject listing');
  const approveTwice = await call(`/api/admin/approve/${pendingApproveId}`, { method: 'PUT', cookie: adminCookie });
  assert.equal(approveTwice.response.status, 409, 'moderation decision cannot be applied twice');
  await db.execute("UPDATE users SET role = 'student' WHERE id = ?", [admin.user.id]);
  const revokedAdmin = await call('/api/admin/pending-items', { cookie: adminCookie });
  assert.equal(revokedAdmin.response.status, 403, 'revoked admin loses access without waiting for session expiry');
  await db.execute("UPDATE users SET role = 'admin' WHERE id = ?", [admin.user.id]);

  const [result] = await db.execute(
    "INSERT INTO items (user_id, title, description, category, status) VALUES (?, ?, ?, 'Books', 'approved')",
    [donorId, `Disposable smoke listing ${suffix}`, 'A temporary listing used only by the API smoke test.']
  );
  testItemId = result.insertId;

  const ownerDetails = await call(`/api/items/${testItemId}`, { cookie: donor.cookie });
  assert.equal(ownerDetails.response.status, 200, 'owner can view their listing');
  assert.deepEqual(ownerDetails.data.item.images, [], 'image-free test listing is supported');
  assert.deepEqual(ownerDetails.data.item.imageData, [], 'image-free test listing returns empty image metadata');

  const selfRequest = await call('/api/requests', {
    method: 'POST', cookie: donor.cookie, body: { itemId: testItemId, needPitch: 'This is my own listing.' }
  });
  assert.equal(selfRequest.response.status, 409, 'self-request is rejected');

  const firstRequest = await call('/api/requests', {
    method: 'POST', cookie: requester.cookie, body: { itemId: testItemId, needPitch: 'I need this for my first semester course.' }
  });
  assert.equal(firstRequest.response.status, 201, 'student can submit a Need Pitch');
  const requestId = firstRequest.data.request.id;

  const duplicateRequest = await call('/api/requests', {
    method: 'POST', cookie: requester.cookie, body: { itemId: testItemId, needPitch: 'I am trying to apply a second time.' }
  });
  assert.equal(duplicateRequest.response.status, 409, 'duplicate application is rejected');

  const secondRequest = await call('/api/requests', {
    method: 'POST', cookie: competingRequester.cookie, body: { itemId: testItemId, needPitch: 'This would support my course work this term.' }
  });
  assert.equal(secondRequest.response.status, 201, 'a second student can apply');

  const hiddenRequests = await call(`/api/requests/item/${testItemId}`, { cookie: requester.cookie });
  assert.equal(hiddenRequests.response.status, 404, 'non-owner cannot see incoming private pitches');
  const donorRequests = await call(`/api/requests/item/${testItemId}`, { cookie: donor.cookie });
  assert.equal(donorRequests.response.status, 200, 'donor can see incoming pitches');
  assert.equal(donorRequests.data.requests.length, 2, 'both pitches are visible to owner');

  const sentMessage = await call('/api/messages', {
    method: 'POST', cookie: requester.cookie, body: { requestId, message: 'Could we arrange a pickup after class?' }
  });
  assert.equal(sentMessage.response.status, 201, 'request participants can message');
  const privateHistory = await call(`/api/messages/${requestId}`, { cookie: requester.cookie });
  assert.equal(privateHistory.response.status, 200, 'request participant can read messages');
  assert.equal(privateHistory.data.messages.length, 1, 'message history is returned');
  const outsiderHistory = await call(`/api/messages/${requestId}`, { cookie: competingRequester.cookie });
  assert.equal(outsiderHistory.response.status, 404, 'non-participant cannot read messages');
  const privateThreads = await call('/api/messages/threads/my-threads', { cookie: competingRequester.cookie });
  assert.equal(privateThreads.data.threads.length, 1, 'only the current student thread is returned');

  const [bannedItemResult] = await db.execute(
    "INSERT INTO items (user_id, title, description, category, status) VALUES (?, ?, ?, 'Other', 'approved')",
    [competingRequester.user.id, `Disposable banned listing ${suffix}`, 'Temporary listing used to verify account ban effects.']
  );
  bannedItemId = bannedItemResult.insertId;
  const bannedUserRequest = await call('/api/requests', {
    method: 'POST', cookie: requester.cookie,
    body: { itemId: bannedItemId, needPitch: 'This request should close when its donor account is banned.' }
  });
  assert.equal(bannedUserRequest.response.status, 201, 'test request is created before ban');

  const bannedAccount = await call(`/api/admin/users/${competingRequester.user.id}/ban`, {
    method: 'PUT', cookie: adminCookie, body: { banned: true }
  });
  assert.equal(bannedAccount.response.status, 200, 'admin can ban a student');
  assert.equal(bannedAccount.data.user.is_banned, true, 'ban state is returned');
  const bannedLogin = await call('/api/auth/login', {
    method: 'POST', body: { email: competingRequester.user.email, password }
  });
  assert.equal(bannedLogin.response.status, 403, 'banned student cannot log in');
  const bannedSession = await call('/api/requests/my-requests', { cookie: competingRequester.cookie });
  assert.equal(bannedSession.response.status, 403, 'existing student session is blocked immediately');
  const removedBannedListing = await call(`/api/items/${bannedItemId}`);
  assert.equal(removedBannedListing.response.status, 404, 'banned student listing is removed from public access');
  const bannedUserQueue = await call(`/api/admin/users?banned=banned&search=${encodeURIComponent(competingRequester.user.email)}`, { cookie: adminCookie });
  assert.equal(bannedUserQueue.data.users.length, 1, 'banned account appears in banned filter');
  const unbannedAccount = await call(`/api/admin/users/${competingRequester.user.id}/ban`, {
    method: 'PUT', cookie: adminCookie, body: { banned: false }
  });
  assert.equal(unbannedAccount.response.status, 200, 'admin can unban a student');
  const unbannedLogin = await call('/api/auth/login', {
    method: 'POST', body: { email: competingRequester.user.email, password }
  });
  assert.equal(unbannedLogin.response.status, 200, 'unbanned student can sign in again');
  const unbannedCookie = rememberSession(unbannedLogin.response);

  const [pointsBeforeRows] = await db.execute('SELECT doner_points FROM users WHERE id = ?', [donorId]);
  const handoff = await call(`/api/items/${testItemId}/donated`, {
    method: 'PUT', cookie: donor.cookie, body: { requesterId: requester.user.id }
  });
  assert.equal(handoff.response.status, 200, 'donor can complete handoff');
  handoffCompleted = true;
  const [pointsAfterRows] = await db.execute('SELECT doner_points FROM users WHERE id = ?', [donorId]);
  assert.equal(pointsAfterRows[0].doner_points, pointsBeforeRows[0].doner_points + 1, 'handoff awards exactly one point');

  const secondHandoff = await call(`/api/items/${testItemId}/donated`, {
    method: 'PUT', cookie: donor.cookie, body: { requesterId: requester.user.id }
  });
  assert.equal(secondHandoff.response.status, 409, 'handoff cannot award points twice');
  const donatedEditForm = new FormData();
  donatedEditForm.append('title', 'Donated item cannot be edited');
  donatedEditForm.append('category', 'Books');
  donatedEditForm.append('description', 'Donated listings cannot be changed.');
  const donatedEdit = await call(`/api/items/${testItemId}`, { method: 'PUT', cookie: donor.cookie, body: donatedEditForm });
  assert.equal(donatedEdit.response.status, 409, 'donated listing cannot be edited');

  const declinedChat = await call('/api/messages', {
    method: 'POST', cookie: unbannedCookie,
    body: { requestId: secondRequest.data.request.id, message: 'Can we still arrange pickup?' }
  });
  assert.equal(declinedChat.response.status, 404, 'declined request chat is closed');

  const donorProfile = await call(`/api/user/${donorId}`);
  assert.equal(donorProfile.response.status, 200, 'public donor profile is available');
  assert.equal(donorProfile.data.profile.email, undefined, 'public profile does not expose email');

  console.log('API smoke test passed: signup validation, OTP endpoints, authentication, multi-photo listings and cover selection, ownership, Need Pitches, private chat, handoff, and points edge cases.');
}

run().catch((error) => {
  console.error('API smoke test failed:', error.message);
  process.exitCode = 1;
}).finally(async () => {
  try {
    const testItemIds = [testItemId, pendingApproveId, pendingRejectId, approvedModerationId, bannedItemId].filter(Boolean);
    if (testItemIds.length) await db.query(`DELETE FROM items WHERE id IN (${testItemIds.map(() => '?').join(',')})`, testItemIds);
    if (handoffCompleted && donorId) await db.execute('UPDATE users SET doner_points = GREATEST(doner_points - 1, 0) WHERE id = ?', [donorId]);
    if (sessionIds.length) await db.query(`DELETE FROM sessions WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`, sessionIds);
    if (identities.length) await db.query(`DELETE FROM users WHERE id IN (${identities.map(() => '?').join(',')})`, identities);
  } catch (error) {
    console.error('Smoke-test cleanup failed:', error.code || error.message);
    process.exitCode = 1;
  }
  const imageCleanup = await Promise.allSettled(cloudinaryPublicIds.map((publicId) => deleteImage(publicId)));
  if (imageCleanup.some((result) => result.status === 'rejected')) {
    console.error('Cloudinary test asset cleanup failed.');
    process.exitCode = 1;
  }
  await db.end();
});