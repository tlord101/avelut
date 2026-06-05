const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
admin.initializeApp();

// 1. Send push notification when a new notification is written to the database (admin pushes)
exports.onNotificationWritten = functions.database.ref('/notifications/{userId}/{notificationId}')
    .onCreate(async (snapshot, context) => {
        const userId = context.params.userId;
        const notification = snapshot.val();
        
        if (!notification) return null;

        // Fetch user's FCM token
        const userSnap = await admin.database().ref(`/users/${userId}`).once('value');
        const userData = userSnap.val();

        if (!userData || !userData.fcm_token) {
            console.log(`Skipping notification for user ${userId}. No FCM Token registered.`);
            return null;
        }

        const message = {
            token: userData.fcm_token,
            notification: {
                title: notification.title || 'VANTUTOR',
                body: notification.message || '',
            },
            data: {
                type: notification.type || 'study_update',
                timestamp: String(notification.timestamp || Date.now())
            },
            android: {
                notification: {
                    color: '#002D62',
                    sound: 'default',
                }
            },
            webpush: {
                notification: {
                    icon: 'https://ai.vaultsglofin.com/logo_notification.svg',
                    badge: 'https://ai.vaultsglofin.com/logo_notification.svg',
                    vibrate: [200, 100, 200],
                    tag: 'vantutor-alert',
                    renotify: true
                }
            }
        };

        try {
            const response = await admin.messaging().send(message);
            console.log('Successfully sent admin push notification:', response);
            return response;
        } catch (error) {
            console.error('Error sending admin push notification:', error);
            return null;
        }
    });

// 2. Send push notification for chat messages
exports.onChatMessageSent = functions.database.ref('/messages/{chatId}/{messageId}')
    .onCreate(async (snapshot, context) => {
        const chatId = context.params.chatId;
        const messageVal = snapshot.val();

        if (!messageVal) return null;

        const senderId = messageVal.senderId;
        const text = messageVal.text || '';
        const type = messageVal.type || 'text';

        // Find recipient in /user_chats/{senderId}/{chatId}
        const userChatSnap = await admin.database().ref(`/user_chats/${senderId}/${chatId}`).once('value');
        const userChatData = userChatSnap.val();

        if (!userChatData || !userChatData.otherUserId) {
            console.log('Could not find otherUserId in user_chats');
            return null;
        }

        const recipientId = userChatData.otherUserId;

        // Read sender's display name
        let senderName = 'Someone';
        try {
            const senderSnap = await admin.database().ref(`/users/${senderId}`).once('value');
            const senderData = senderSnap.val();
            if (senderData && senderData.display_name) {
                senderName = senderData.display_name;
            }
        } catch (err) {
            console.error('Error reading sender display_name from database:', err);
        }

        if (senderName === 'Someone' || !senderName) {
            try {
                const userRecord = await admin.auth().getUser(senderId);
                if (userRecord && userRecord.displayName) {
                    senderName = userRecord.displayName;
                } else if (userRecord && userRecord.email) {
                    senderName = userRecord.email.split('@')[0];
                }
            } catch (err) {
                console.error('Error reading sender from auth:', err);
            }
        }

        // Read recipient's FCM token and check if they enabled notifications
        const recipientSnap = await admin.database().ref(`/users/${recipientId}`).once('value');
        const recipientData = recipientSnap.val();

        if (!recipientData || !recipientData.fcm_token) {
            console.log(`Skipping message push for user ${recipientId}. No token registered.`);
            return null;
        }

        let bodyPreview = text;
        if (type === 'voice') bodyPreview = '🎵 Sent a voice message';
        else if (type === 'image') bodyPreview = '📷 Sent an image';
        else if (type === 'file') bodyPreview = '📄 Sent a file';

        const payload = {
            token: recipientData.fcm_token,
            notification: {
                title: senderName,
                body: bodyPreview,
            },
            data: {
                chatId: chatId,
                type: 'private_chat'
            },
            android: {
                notification: {
                    color: '#002D62',
                    sound: 'default',
                }
            },
            webpush: {
                notification: {
                    icon: senderData.photo_url || 'https://ai.vaultsglofin.com/logo_notification.svg',
                    badge: 'https://ai.vaultsglofin.com/logo_notification.svg',
                    vibrate: [200, 100, 200],
                    tag: `chat-${chatId}`,
                    renotify: true
                }
            }
        };

        try {
            const response = await admin.messaging().send(payload);
            console.log('Successfully sent message push notification:', response);
            return response;
        } catch (error) {
            console.error('Error sending message push notification:', error);
            return null;
        }
    });

// 3. Scheduled function to send automatic reminders to inactive users
exports.sendAutomaticReminders = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
    const usersSnap = await admin.database().ref('/users').once('value');
    if (!usersSnap.exists()) return null;

    const users = usersSnap.val();
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const promises = [];

    for (const userId in users) {
        const user = users[userId];
        if (user.notifications_enabled && user.fcm_token && user.last_activity_date && user.last_activity_date < twentyFourHoursAgo) {
            const message = {
                token: user.fcm_token,
                notification: {
                    title: '📚 Ready to study?',
                    body: `Hi ${user.display_name || 'there'}! It's time to review your roadmap and continue your lessons on VANTUTOR.`,
                },
                android: {
                    notification: {
                        color: '#002D62',
                        sound: 'default',
                    }
                },
                webpush: {
                    notification: {
                        icon: 'https://ai.vaultsglofin.com/logo_notification.svg',
                        badge: 'https://ai.vaultsglofin.com/logo_notification.svg',
                        vibrate: [200, 100, 200],
                        tag: 'vantutor-reminder',
                        renotify: true
                    }
                }
            };
            
            // Log reminder notification in user's notifications list
            const notifRef = admin.database().ref(`/notifications/${userId}`).push();
            const logPromise = notifRef.set({
                type: 'study_update',
                title: '📚 Daily Study Reminder',
                message: "It's time to continue your learning path!",
                is_read: false,
                timestamp: now
            });

            const sendPromise = admin.messaging().send(message)
                .then(res => console.log(`Sent reminder to ${userId}`))
                .catch(err => console.error(`Failed to send reminder to ${userId}:`, err));

            promises.push(logPromise);
            promises.push(sendPromise);
        }
    }

    return Promise.all(promises);
});

// 4. Programmatic SMTP email delivery from database queue
exports.processEmailQueue = functions.database.ref('/email_queue/{queueId}')
    .onCreate(async (snapshot, context) => {
        const queueId = context.params.queueId;
        const job = snapshot.val();
        if (!job) return null;

        try {
            // Retrieve SMTP settings
            const configSnap = await admin.database().ref('app_settings/email_config').once('value');
            const config = configSnap.val();

            if (!config || !config.host || !config.port || !config.user || !config.pass) {
                throw new Error("SMTP configuration is missing or incomplete in app_settings/email_config.");
            }

            // Create transport
            const transporter = nodemailer.createTransport({
                host: config.host,
                port: parseInt(config.port, 10),
                secure: config.secure === true,
                auth: {
                    user: config.user,
                    pass: config.pass
                }
            });

            const fromName = config.from_name || 'VanTutor';
            const fromEmail = config.from_email || config.user;

            const mailOptions = {
                from: `"${fromName}" <${fromEmail}>`,
                to: fromEmail, // Send to self as main recipient
                bcc: job.recipients, // Recipients in BCC to protect privacy
                subject: job.subject,
                text: job.body
            };

            await transporter.sendMail(mailOptions);

            // Update queue item to success
            return snapshot.ref.update({
                status: 'success',
                sent_at: Date.now()
            });

        } catch (error) {
            console.error(`Error processing email queue job ${queueId}:`, error);
            return snapshot.ref.update({
                status: 'failed',
                error_message: error.message,
                failed_at: Date.now()
            });
        }
    });

// 5. Scheduled function to check study timetables every minute and send reminders
exports.checkTimetableReminders = functions.pubsub.schedule('* * * * *').onRun(async (context) => {
    const usersSnap = await admin.database().ref('/users').once('value');
    if (!usersSnap.exists()) return null;

    const users = usersSnap.val();
    const nowServer = new Date();
    const promises = [];

    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    for (const userId in users) {
        const userData = users[userId];
        if (!userData || !userData.timetable) continue;

        // Determine user's local day, hour, and minute
        const userTimezone = userData.timezone || 'UTC';
        let userLocalDate;
        try {
            const localDateStr = nowServer.toLocaleString('en-US', { timeZone: userTimezone });
            userLocalDate = new Date(localDateStr);
        } catch (err) {
            console.error(`Invalid timezone "${userTimezone}" for user ${userId}, falling back to UTC.`);
            userLocalDate = nowServer;
        }

        const userDay = days[userLocalDate.getDay()];
        const userHour = userLocalDate.getHours();
        const userMinute = userLocalDate.getMinutes();
        const userCurrentMinutes = userHour * 60 + userMinute;
        
        const year = userLocalDate.getFullYear();
        const month = String(userLocalDate.getMonth() + 1).padStart(2, '0');
        const dateDay = String(userLocalDate.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${dateDay}`;

        const timetable = Array.isArray(userData.timetable) 
            ? userData.timetable 
            : Object.values(userData.timetable);

        for (const session of timetable) {
            if (!session || !session.day || !session.time || !session.subject) continue;
            // Check if it's the correct day of the week
            if (session.day.toLowerCase() !== userDay.toLowerCase()) continue;

            // Extract start time from range e.g. "09:00 AM - 11:00 AM"
            const parts = session.time.split('-');
            const startStr = parts[0].trim();

            // Try 12-hour AM/PM format
            let match = startStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
            let hour, minute;
            if (match) {
                hour = parseInt(match[1], 10);
                minute = parseInt(match[2], 10);
                const ampm = match[3].toUpperCase();
                if (ampm === 'PM' && hour < 12) {
                    hour += 12;
                } else if (ampm === 'AM' && hour === 12) {
                    hour = 0;
                }
            } else {
                // Try 24-hour format
                match = startStr.match(/(\d+):(\d+)/);
                if (match) {
                    hour = parseInt(match[1], 10);
                    minute = parseInt(match[2], 10);
                }
            }

            if (hour === undefined || minute === undefined) continue;

            const sessionStartMinutes = hour * 60 + minute;
            const diffMinutes = sessionStartMinutes - userCurrentMinutes;

            let reminderType = null;
            let title = '';
            let message = '';
            
            // Check windows:
            // 10 minutes warning (8 to 12 minutes before)
            // Exact time start (-2 to 2 minutes)
            if (diffMinutes >= 8 && diffMinutes <= 12) {
                reminderType = 'warning';
                title = '📚 Upcoming Study Session';
                message = `Your study session on "${session.subject}" starts in 10 minutes (at ${startStr})! Topic: ${session.topic || 'Review'}.`;
            } else if (diffMinutes >= -2 && diffMinutes <= 2) {
                reminderType = 'start';
                title = '⏰ Time to Study!';
                message = `Your study session on "${session.subject}" starts now! Topic: ${session.topic || 'Review'}. Activity: ${session.activity || 'Read and practice'}.`;
            }

            if (!reminderType) continue;

            const reminderKey = `${session.id}_${reminderType}_${dateString}`;
            const sentLogRef = admin.database().ref(`/users/${userId}/sent_reminders/${reminderKey}`);
            
            const runTransaction = async () => {
                const logSnap = await sentLogRef.once('value');
                if (logSnap.exists()) {
                    return;
                }

                // Log immediately to prevent duplication in simultaneous triggers
                await sentLogRef.set(true);

                console.log(`Sending timetable reminder (${reminderType}) to user ${userId} for session ${session.id}`);

                // Write push notification to /notifications/{userId}
                const notifRef = admin.database().ref(`/notifications/${userId}`).push();
                const pushPromise = notifRef.set({
                    type: 'study_reminder',
                    title: title,
                    message: message,
                    is_read: false,
                    timestamp: Date.now()
                });

                // Write email to /email_queue
                let emailPromise = Promise.resolve();
                if (userData.email) {
                    const emailRef = admin.database().ref('/email_queue').push();
                    emailPromise = emailRef.set({
                        recipients: userData.email,
                        subject: `${title}: ${session.subject}`,
                        body: `Hi ${userData.display_name || 'Learner'},\n\n${message}\n\nHappy learning,\nThe VANTUTOR Team`,
                        created_at: Date.now(),
                        status: 'pending'
                    });
                }

                await Promise.all([pushPromise, emailPromise]);
            };

            promises.push(runTransaction().catch(err => {
                console.error(`Error sending reminder to user ${userId} for session ${session.id}:`, err);
            }));
        }
    }

    await Promise.all(promises);
    return null;
});

