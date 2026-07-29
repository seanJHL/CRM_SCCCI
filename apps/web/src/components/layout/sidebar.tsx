import { Link } from "@tanstack/react-router";

const navItems = [
  { to: "/", label: "Dashboard", icon: IconDashboard },
  { to: "/companies", label: "Companies", icon: IconBuilding },
  { to: "/contacts", label: "Contacts", icon: IconUsers },
  { to: "/deals", label: "Deals", icon: IconHandshake },
];

export function Sidebar() {
  return (
    <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-6">
        <div className="h-8 w-8 rounded-lg bg-brand-600" />
        <span className="text-lg font-bold text-gray-900">SCCCI CRM</span>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            activeProps={{
              className:
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium bg-brand-50 text-brand-700",
            }}
          >
            <item.icon />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-gray-200 p-4">
        <p className="text-xs text-gray-400">CRM SCCCI v0.1.0</p>
      </div>
    </aside>
  );
}

function IconDashboard() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
      />
    </svg>
  );
}

function IconBuilding() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 21h16.5M4.5 3h15M6.75 3v18m10.5-18v18M9 6h.01M9 9h.01M9 12h.01M9 15h.01M12 6h.01M12 9h.01M12 12h.01M12 15h.01M15 6h.01M15 9h.01M15 12h.01M15 15h.01"
      />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-.521-.251-.99-.635-1.27m.635 1.27a9.364 9.364 0 01-3.75-.781m3.75.781v.003c0 .521-.251.99-.635 1.271m0 0a4.126 4.126 0 01-3.75-.781M5.25 5.625a4.125 4.125 0 018.25 0v.375c0 1.5-.75 3-1.875 3.875A4.125 4.125 0 015.25 5.625z"
      />
    </svg>
  );
}

function IconHandshake() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 12L3.75 9.75M6 12l3 3m-3-3l3-3m9 3l-3-3m3 3l3-3m-3 3l-3 3m-3-3l3 3m-6 6l3-3m-3 3l-3-3m3 3l3 3m0 0l3-3"
      />
    </svg>
  );
}
