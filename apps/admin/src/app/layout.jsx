import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "JFT Admin",
  description: "Admin panel for JFT mock results"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
