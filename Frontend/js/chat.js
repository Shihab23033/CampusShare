const chatApp = window.CampusShare;
const threadList = document.querySelector('#thread-list');
const messageList = document.querySelector('#message-list');
const chatLayout = document.querySelector('#chat-layout');
const messageForm = document.querySelector('#message-form');
const messageInput = document.querySelector('#message-input');
const sendButton = messageForm.querySelector('button');
let chatUser;
let threads = [];
let activeRequestId = null;
let newestMessageId = 0;
let polling = false;

function counterpart(thread) {
  const isDonor = Number(thread.donor_id) === Number(chatUser.id);
  return {
    name: isDonor ? thread.requester_name : thread.donor_name,
    avatar: isDonor ? thread.requester_avatar : thread.donor_avatar
  };
}

function renderThreads() {
  if (!threads.length) {
    threadList.innerHTML = '<div class="empty-state">No conversations yet. A chat becomes available after someone requests your item or you send a Need Pitch.</div>';
    return;
  }
  threadList.innerHTML = threads.map((thread) => {
    const person = counterpart(thread);
    return `<button class="thread-row${Number(thread.request_id) === Number(activeRequestId) ? ' active' : ''}" data-request-id="${thread.request_id}" type="button">
      <span class="thread-avatar">${person.avatar ? `<img src="${chatApp.escapeHtml(person.avatar)}" alt="">` : chatApp.escapeHtml(person.name.slice(0, 1).toUpperCase())}</span>
      <span class="thread-copy"><strong>${chatApp.escapeHtml(person.name)}</strong><small>${chatApp.escapeHtml(thread.item_title)}</small><span>${chatApp.escapeHtml(thread.last_message || 'Need Pitch submitted')}</span></span>
      <span class="thread-status status-${chatApp.escapeHtml(thread.request_status)}">${thread.request_status}</span>
    </button>`;
  }).join('');
  threadList.querySelectorAll('.thread-row').forEach((button) => button.addEventListener('click', () => openThread(button.dataset.requestId)));
}

function renderMessages(messages, append) {
  if (!append) messageList.innerHTML = '';
  if (!append && !messages.length) {
    messageList.innerHTML = '<div class="empty-state">Say hello to start the conversation.</div>';
    return;
  }
  if (!messages.length) return;
  const markup = messages.map((message) => {
    const own = Number(message.sender_id) === Number(chatUser.id);
    const time = new Date(message.created_at);
    const timestamp = Number.isNaN(time.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(time);
    newestMessageId = Math.max(newestMessageId, Number(message.id));
    return `<article class="message-bubble${own ? ' own' : ''}"><p>${chatApp.escapeHtml(message.message_text)}</p><small>${own ? 'You' : chatApp.escapeHtml(message.sender_name)} · ${timestamp}</small></article>`;
  }).join('');
  messageList.insertAdjacentHTML('beforeend', markup);
  messageList.scrollTop = messageList.scrollHeight;
}

async function openThread(requestId) {
  activeRequestId = Number(requestId);
  const selectedRequestId = activeRequestId;
  newestMessageId = 0;
  const thread = threads.find((item) => Number(item.request_id) === activeRequestId);
  if (!thread) return;
  const person = counterpart(thread);
  document.querySelector('#conversation-title').textContent = person.name;
  document.querySelector('#conversation-subtitle').textContent = `${thread.item_title} · ${thread.request_status}`;
  messageInput.disabled = false;
  sendButton.disabled = false;
  threadList.querySelectorAll('.thread-row').forEach((button) => button.classList.toggle('active', Number(button.dataset.requestId) === activeRequestId));
  chatLayout.classList.add('conversation-open');
  const url = new URL(window.location.href);
  url.searchParams.set('requestId', String(activeRequestId));
  window.history.replaceState({}, '', url);
  try {
    const data = await chatApp.api(`/api/messages/${selectedRequestId}`);
    if (activeRequestId !== selectedRequestId) return;
    renderMessages(data.messages, false);
    if (data.requestStatus === 'declined') {
      messageInput.disabled = true;
      sendButton.disabled = true;
    }
  } catch (error) {
    if (activeRequestId !== selectedRequestId) return;
    messageList.innerHTML = `<div class="empty-state">${chatApp.escapeHtml(error.message)}</div>`;
  }
}

async function pollMessages() {
  if (!activeRequestId || polling) return;
  polling = true;
  const requestId = activeRequestId;
  try {
    const data = await chatApp.api(`/api/messages/${requestId}?afterId=${newestMessageId}`);
    if (activeRequestId !== requestId) return;
    renderMessages(data.messages, true);
    if (data.requestStatus === 'declined') {
      messageInput.disabled = true;
      sendButton.disabled = true;
    }
    const updatedThreads = await chatApp.api('/api/messages/threads/my-threads');
    if (activeRequestId !== requestId) return;
    threads = updatedThreads.threads;
    renderThreads();
  } catch {
    // A failed poll is retried on the next interval.
  } finally {
    polling = false;
  }
}

messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!activeRequestId || !message || message.length > 2000) return;
  chatApp.setBusy(sendButton, true, 'Sending…');
  const toast = chatApp.notify('Sending message…', 'loading', 0);
  try {
    const data = await chatApp.api('/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: activeRequestId, message })
    });
    messageInput.value = '';
    renderMessages([{ ...data.message, sender_name: chatUser.name, created_at: new Date().toISOString() }], true);
    toast.update('Message sent.', 'success', 1800);
  } catch (error) {
    chatApp.showNotice(error.message);
    toast.update(error.message, 'error', 6000);
  } finally {
    chatApp.setBusy(sendButton, false);
    sendButton.disabled = messageInput.disabled;
  }
});

document.querySelector('#chat-back').addEventListener('click', () => chatLayout.classList.remove('conversation-open'));

(async () => {
  chatUser = await chatApp.requireStudent();
  if (!chatUser) return;
  try {
    const data = await chatApp.api('/api/messages/threads/my-threads');
    threads = data.threads;
    renderThreads();
    const requestedThread = new URLSearchParams(window.location.search).get('requestId');
    const validThread = threads.find((thread) => Number(thread.request_id) === Number(requestedThread));
    if (validThread) await openThread(validThread.request_id);
    else if (requestedThread) chatApp.showNotice('That conversation is not available to your account.');
  } catch (error) {
    chatApp.showNotice(error.message);
  }
})();

const pollTimer = window.setInterval(pollMessages, 3000);
window.addEventListener('pagehide', () => window.clearInterval(pollTimer), { once: true });