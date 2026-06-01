self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const chatId = event.notification?.data?.chatId;
	const messengerUrl = chatId ? `/?openMessengerChatId=${encodeURIComponent(chatId)}` : '/';

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
			for (const client of clients) {
				if ('focus' in client) {
					if (chatId) {
						client.postMessage({ type: 'open-messenger-chat', chatId });
					}
					return client.focus();
				}
			}
			if (self.clients.openWindow) {
				return self.clients.openWindow(messengerUrl);
			}
			return undefined;
		})
	);
});
