import "./globals.css";

export const metadata = {
  title: 'IntentShield AIG | NEAR Protocol Security Middleware',
  description: 'Asynchronous Intent Guard & MCP Security Middleware for NEAR Protocol',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-[#0a0f1d] text-gray-100 min-h-screen selection:bg-emerald-500 selection:text-black">
        {children}
      </body>
    </html>
  )
}
