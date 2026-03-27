import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/app/ui/sidebar";
import { getServerAuth } from "@/lib/auth";
import { getAccessibleModulesForUser } from "@/lib/user";

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

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex bg-gray-50/30">
        {auth && (
          <Sidebar 
            user={{ name: auth.user.name, email: auth.user.email }} 
            modules={accessibleModules.map(m => ({
              id: m.id,
              slug: m.slug,
              name: m.name,
              category: m.category
            }))} 
          />
        )}
        <div className={`flex-1 flex flex-col min-h-screen transition-all duration-300 ${auth ? 'sidebar-margin' : ''}`}>
          {children}
        </div>
        {/* Helper for the main content to avoid overlap using CSS-only detection of sidebar width */}
        {auth && (
          <style dangerouslySetInnerHTML={{ __html: `
            .sidebar-margin { transition: margin-left 300ms cubic-bezier(0.4, 0, 0.2, 1); }
            body:has(aside.w-16) .sidebar-margin { margin-left: 4rem; }
            body:has(aside.w-72) .sidebar-margin { margin-left: 18rem; }
          `}} />
        )}
      </body>
    </html>
  );
}
