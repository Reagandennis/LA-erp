'use client';

import MessagingConsole from '../_components/messaging-console';
import TelegramSignIn from './telegram-sign-in';

/**
 * Client wrapper so the sign-in render prop is created on the client.
 * A Server Component cannot pass a function to a Client Component, so the page
 * renders this instead of wiring MessagingConsole directly.
 */
export default function TelegramConsole({ initialChatId }: { initialChatId?: string | null }) {
  return (
    <MessagingConsole
      initialChatId={initialChatId}
      config={{
        service: 'telegram',
        title: 'Telegram',
        subtitle: 'Your chats, groups & channels',
        searchPlaceholder: 'Search chats & groups…',
        connectionNoun: 'Account',
        newChatPlaceholder: '@username',
      }}
      signIn={({ onSignedIn }) => <TelegramSignIn onSignedIn={onSignedIn} />}
    />
  );
}
