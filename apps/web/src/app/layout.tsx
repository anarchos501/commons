import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Commons",
  description: "Mutual aid coordination without unnecessary surveillance or hidden authority.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const stripFormFillHydrationAttributes = `
(() => {
  const attribute = "fdprocessedid";
  const clean = (root) => {
    if (!root || root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.hasAttribute(attribute)) root.removeAttribute(attribute);
    root.querySelectorAll?.("[" + attribute + "]").forEach((element) => element.removeAttribute(attribute));
  };
  clean(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        mutation.target.removeAttribute(attribute);
      } else {
        mutation.addedNodes.forEach(clean);
      }
    }
  });
  observer.observe(document.documentElement, {
    attributeFilter: [attribute],
    attributes: true,
    childList: true,
    subtree: true,
  });
  window.addEventListener("load", () => setTimeout(() => observer.disconnect(), 5000), { once: true });
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const theme = cookieStore.get("commons_theme")?.value;
  const themeClass = theme === "dark" ? "dark" : "";
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased ${themeClass}`.trim()}
    >
      <body className="min-h-full flex flex-col">
        <Script id="strip-form-fill-hydration-attributes" strategy="beforeInteractive">
          {stripFormFillHydrationAttributes}
        </Script>
        {children}
      </body>
    </html>
  );
}
