import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="th">
      <body className="font-sans antialiased text-slate-800">
        {children}
      </body>
    </html>
  );
}