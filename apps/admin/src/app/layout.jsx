import "./globals.css";

export const metadata = {
  title: "JFT Admin",
  description: "Admin panel for JFT mock results"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

