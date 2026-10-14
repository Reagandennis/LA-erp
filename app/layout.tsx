import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/app/ui/sidebar";
import { BannerProvider } from "@/app/ui/banner";
import NotificationsBell from "@/app/ui/notifications-bell";
import WorldClockTicker from "@/app/ui/world-clock-ticker";
import { getServerAuth } from "@/lib/auth";
import { getAccessibleModulesForUser } from "@/lib/user";
import { resolveWorldClockZones } from "@/lib/world-clocks";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LA-ERP",
  description: "Administrator-managed ERP with audited access control",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const auth = await getServerAuth();
  const accessibleModules = auth ? await getAccessibleModulesForUser(auth.user) : [];
  const sidebarUser = auth
    ? { name: auth.user.name, email: auth.user.email }
    : { name: 'Guest', email: 'guest@la-erp.local' };
  const shouldShowSidebar = true;

  const worldClockZones = resolveWorldClockZones(
    auth?.preferences.worldClockZones ?? [],
  );

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex bg-gray-50/30">
        <BannerProvider>
        {shouldShowSidebar && (
          <Sidebar
            user={sidebarUser}
            modules={accessibleModules.map((m) => ({
              id: m.id,
              slug: m.slug,
              name: m.name,
              category: m.category,
            }))}
          />
        )}
        {auth && <WorldClockTicker initialZones={worldClockZones} />}
        {auth && <NotificationsBell />}
        <div className={`flex-1 flex flex-col min-h-screen transition-all duration-300 ${shouldShowSidebar ? 'sidebar-margin' : ''}`}>
          {children}
        </div>
        {/* Helper for the main content to avoid overlap using CSS-only detection of sidebar width */}
        {shouldShowSidebar && (
          <style dangerouslySetInnerHTML={{ __html: `
            .sidebar-margin { transition: margin-left 300ms cubic-bezier(0.4, 0, 0.2, 1); }
            body:has(aside.w-16) .sidebar-margin { margin-left: 4rem; }
            body:has(aside.w-72) .sidebar-margin { margin-left: 18rem; }
            .ticker-bar { position: fixed; top: 0; right: 0; left: 0; z-index: 200; height: 3rem; }
            body:has(aside.w-16) .ticker-bar { left: 4rem; }
            body:has(aside.w-72) .ticker-bar { left: 18rem; }
            body:has(.ticker-bar) .sidebar-margin { padding-top: 3rem; }
          `}} />
        )}
        </BannerProvider>
      </body>
    </html>
  );
}
