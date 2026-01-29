import type { Metadata } from "next";
import { Sarabun } from "next/font/google"; // ตรวจสอบว่าใช้ / ไม่ใช่ -
import "./globals.css";

// ตั้งค่าฟอนต์ Sarabun
const sarabun = Sarabun({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sarabun", // สร้างตัวแปร CSS ไว้ใช้ใน Tailwind
});

export const metadata: Metadata = {
  title: "BuildFlow Pro",
  description: "ระบบจัดการงานก่อสร้าง",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      {/* นำตัวแปรฟอนต์มาใส่ที่ body */}
      <body className={`${sarabun.variable} font-sans antialiased text-slate-800`}>
        {children}
      </body>
    </html>
  );
}