import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import AdminStartupDiagnostics from "../components/AdminStartupDiagnostics";

export const metadata = {
  title: "JFT Navi Admin Panel",
  description: "Admin panel for JFT Navi",
  applicationName: "JFT Navi Admin Panel",
  appleWebApp: {
    title: "JFT Navi Admin Panel",
  },
  openGraph: {
    title: "JFT Navi Admin Panel",
    description: "Admin panel for JFT Navi",
  },
  twitter: {
    card: "summary",
    title: "JFT Navi Admin Panel",
    description: "Admin panel for JFT Navi",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AdminStartupDiagnostics />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
