import type { Metadata } from "next";
import { Inter, Noto_Sans_Thai } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-thai",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BuildFlow Pro",
  description: "Construction workflow management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" className={`${inter.variable} ${notoSansThai.variable}`}>
      <body className="font-sans antialiased text-slate-800">
        {/* Mounted at the root so every route - including /login and
            /register, which sit outside the dashboard shell - can raise a
            toast through useToast(). */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}