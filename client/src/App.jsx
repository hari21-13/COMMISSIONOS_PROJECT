import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard,
  Building2,
  Users,
  FileSpreadsheet,
  Calculator,
  RotateCcw,
  FileText,
  CheckCircle2,
  Wallet,
  AlertTriangle,
  BarChart3,
  ShieldCheck,
  Plus,
  Search,
  Download,
  Upload,
  Eye,
  Edit3,
  Trash2,
  Lock,
  Check,
  X,
  RefreshCw,
  Sliders,
  Award,
  UserCheck,
  Clock,
  Send,
  Menu,
  CreditCard,
  LogOut,
  LogIn,
  Mail,
  Crown,
  Phone,
  MessageCircle,
  MapPin,
  QrCode,
  User,
  EyeOff,
  Sun,
  Moon,
} from "lucide-react";

// ============================================================================
// UTILITIES & CURRENCY FORMATTER
// ============================================================================
const formatINR = (amount) => {
  const num = Number(amount) || 0;
  const isNeg = num < 0;
  const abs = Math.abs(num);
  return `${isNeg ? "-" : ""}₹${abs.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: abs % 1 !== 0 ? 2 : 0,
  })}`;
};

const downloadCSV = (filename, headers, rows) => {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csvContent =
    "data:text/csv;charset=utf-8," +
    [
      headers.map(escape).join(","),
      ...rows.map((r) => r.map(escape).join(",")),
    ].join("\n");
  const link = document.createElement("a");
  link.setAttribute("href", encodeURI(csvContent));
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

function useLocalState(key, initialValue) {
  const storageKey = `commissionos_v1:${key}`;
  const [state, setState] = useState(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      return saved !== null ? JSON.parse(saved) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* ignore quota errors */
    }
  }, [storageKey, state]);
  return [state, setState];
}

// ============================================================================
// INITIAL SEED DATA & 7 COMMISSION MODELS ENGINE
// ============================================================================
const INITIAL_ORG = {
  name: "Alpha Auron Private Limited",
  gstin: "29AABCA8492K1Z5",
  address: "BTM Layout, Bengaluru, Karnataka, India",
  currency: "INR (₹)",
  cycle: "Monthly",
  upiId: "alphaauron@okaxis",
  contact: {
    name: "Poojitha",
    email: "poojitha@alphaauron.com",
    phone: "7207642479",
    hours: "9:30 AM – 6:30 PM",
    days: "Monday to Friday",
  },
};

const INITIAL_DEPARTMENTS = [
  { id: "DEPT01", name: "Enterprise Sales", head: "Priya Sharma", target: 2500000, active: true },
  { id: "DEPT02", name: "Channel & Partner", head: "Rahul Verma", target: 1500000, active: true },
  { id: "DEPT03", name: "Inbound Growth", head: "Ananya Rao", target: 1000000, active: true },
];

const INITIAL_EMPLOYEES = [
  {
    id: "EMP001",
    name: "Rahul Verma",
    email: "rahul@alphaauron.com",
    role: "Senior Sales Executive",
    portalRole: "employee",
    department: "Channel & Partner",
    policyId: "POL001",
    bankAccount: "HDFC •••• 4821",
    ifsc: "HDFC0001204",
    status: "Active",
  },
  {
    id: "EMP002",
    name: "Priya Sharma",
    email: "priya@alphaauron.com",
    role: "Enterprise Account Director",
    portalRole: "employee",
    department: "Enterprise Sales",
    policyId: "POL003",
    bankAccount: "ICICI •••• 9930",
    ifsc: "ICIC0000412",
    status: "Active",
  },
  {
    id: "EMP003",
    name: "Kiran Partner",
    email: "kiran@partnerhub.in",
    role: "Channel Referral Partner",
    portalRole: "user",
    department: "Channel & Partner",
    policyId: "POL002",
    bankAccount: "SBI •••• 7712",
    ifsc: "SBIN0004312",
    status: "Active",
  },
];

const INITIAL_POLICIES = [
  {
    id: "POL001",
    name: "Standard Flat 5% Commission",
    model: "A",
    modelLabel: "Model A: Fixed Percentage",
    rate: 5,
    status: "Active",
  },
  {
    id: "POL002",
    name: "Partner Per-Sale Bounty",
    model: "B",
    modelLabel: "Model B: Fixed Per-Sale",
    fixedAmount: 4500,
    status: "Active",
  },
  {
    id: "POL003",
    name: "Enterprise Progressive Slabs",
    model: "C",
    modelLabel: "Model C: Marginal Tiered",
    tierMethod: "marginal",
    slabs: [
      { min: 0, max: 100000, rate: 3 },
      { min: 100001, max: 300000, rate: 5 },
      { min: 300001, max: 99999999, rate: 8 },
    ],
    status: "Active",
  },
  {
    id: "POL004",
    name: "Quarterly Quota Accelerator",
    model: "D",
    modelLabel: "Model D: Target Bonus",
    targetAmount: 500000,
    targetBonus: 25000,
    status: "Active",
  },
];

const INITIAL_TRANSACTIONS = [
  {
    id: "TXN001",
    invoiceNumber: "INV-2026-1001",
    customer: "Tata Digital Services",
    product: "CommissionOS Enterprise",
    date: "04-11-2026",
    invoiceAmount: 450000,
    discount: 25000,
    eligibleBase: 425000,
    salesperson: "Priya Sharma",
    salespersonId: "EMP002",
    department: "Enterprise Sales",
    status: "Eligible",
  },
  {
    id: "TXN002",
    invoiceNumber: "INV-2026-1002",
    customer: "Zomato Hyperpure",
    product: "Growth Suite",
    date: "09-11-2026",
    invoiceAmount: 180000,
    discount: 10000,
    eligibleBase: 170000,
    salesperson: "Rahul Verma",
    salespersonId: "EMP001",
    department: "Channel & Partner",
    status: "Validated",
  },
  {
    id: "TXN003",
    invoiceNumber: "INV-2026-1003",
    customer: "RazorpayX Partner Deal",
    product: "Starter Pack",
    date: "14-11-2026",
    invoiceAmount: 95000,
    discount: 0,
    eligibleBase: 95000,
    salesperson: "Kiran Partner",
    salespersonId: "EMP003",
    department: "Channel & Partner",
    status: "Eligible",
  },
  {
    id: "TXN004",
    invoiceNumber: "INV-2026-1004",
    customer: "Infosys BPM",
    product: "Custom Integration",
    date: "19-11-2026",
    invoiceAmount: 320000,
    discount: 20000,
    eligibleBase: 300000,
    salesperson: "Priya Sharma",
    salespersonId: "EMP002",
    department: "Enterprise Sales",
    status: "Pending Validation",
  },
];

const INITIAL_REVERSALS = [
  {
    id: "REV001",
    txnId: "TXN002",
    invoiceNumber: "INV-2026-1002",
    salesperson: "Rahul Verma",
    reason: "Partial Seat Downgrade",
    refundAmount: 30000,
    clawbackAmount: 1500,
    date: "21-11-2026",
    status: "Applied",
  },
];

const INITIAL_STATEMENTS = [
  {
    id: "STMT-2026-11-01",
    period: "Nov 2026",
    employeeId: "EMP002",
    employeeName: "Priya Sharma",
    grossSales: 725000,
    grossCommission: 41000,
    clawbacks: 0,
    adjustments: 2500,
    netPayable: 43500,
    stage: 5,
    status: "Finance Verified",
    locked: false,
  },
  {
    id: "STMT-2026-11-02",
    period: "Nov 2026",
    employeeId: "EMP001",
    employeeName: "Rahul Verma",
    grossSales: 170000,
    grossCommission: 8500,
    clawbacks: 1500,
    adjustments: 0,
    netPayable: 7000,
    stage: 6,
    status: "Approved for Payout",
    locked: true,
  },
  {
    id: "STMT-2026-11-03",
    period: "Nov 2026",
    employeeId: "EMP003",
    employeeName: "Kiran Partner",
    grossSales: 95000,
    grossCommission: 4500,
    clawbacks: 0,
    adjustments: 0,
    netPayable: 4500,
    stage: 7,
    status: "Paid & Locked",
    locked: true,
  },
];

const INITIAL_PAYOUTS = [
  {
    id: "PAY-9001",
    statementId: "STMT-2026-11-03",
    employeeName: "Kiran Partner",
    method: "NEFT / IMPS",
    utr: "UTR62849102941",
    amount: 4500,
    date: "25-11-2026",
    status: "Reconciled",
  },
  {
    id: "PAY-9002",
    statementId: "STMT-2026-11-02",
    employeeName: "Rahul Verma",
    method: "RazorpayX Payout",
    utr: "PENDING-BATCH",
    amount: 7000,
    date: "26-11-2026",
    status: "Queued",
  },
];

const INITIAL_DISPUTES = [
  {
    id: "DSP-101",
    statementId: "STMT-2026-11-01",
    raisedBy: "Priya Sharma",
    category: "Accelerator Tier Rate",
    claimedDelta: 4500,
    description: "Enterprise deal INV-2026-1001 crossed ₹4L threshold; requesting 8% marginal slab check.",
    status: "Under Review",
    createdAt: "24-11-2026",
  },
];

const APPROVAL_STAGES = [
  "1. Draft Generated",
  "2. Ops Validation",
  "3. Team Lead Review",
  "4. Dept Head Sign-off",
  "5. Finance Audit",
  "6. Executive Approval",
  "7. Locked & Released",
];

const SAAS_PLANS = [
  { id: "starter", name: "Starter", price: 0, users: 5, txns: 500, badge: "Free" },
  { id: "growth", name: "Growth", price: 2499, users: 25, txns: 5000, badge: "Popular" },
  { id: "business", name: "Business", price: 5999, users: 100, txns: 999999, badge: "Full Suite" },
  { id: "enterprise", name: "Enterprise", price: 14999, users: 9999, txns: 9999999, badge: "Custom SLA" },
];

function computePolicyCommission(policy, salesAmount, saleCount = 1, product = "Product A") {
  const sales = Number(salesAmount) || 0;
  if (!policy) return { commission: 0, breakdown: "No policy assigned" };

  switch (policy.model) {
    case "A": {
      const rate = Number(policy.rate) || 0;
      const comm = (sales * rate) / 100;
      return { commission: comm, breakdown: `${formatINR(sales)} × ${rate}% = ${formatINR(comm)}` };
    }
    case "B": {
      const perSale = Number(policy.fixedAmount) || 0;
      const comm = saleCount * perSale;
      return { commission: comm, breakdown: `${saleCount} sale(s) × ${formatINR(perSale)} = ${formatINR(comm)}` };
    }
    case "C": {
      const slabs = policy.slabs?.length
        ? policy.slabs
        : [
            { min: 0, max: 100000, rate: 3 },
            { min: 100001, max: 300000, rate: 5 },
            { min: 300001, max: 99999999, rate: 8 },
          ];
      let remaining = sales;
      let total = 0;
      const parts = [];
      let prevMax = 0;
      for (const s of slabs) {
        if (remaining <= 0) break;
        const span = s.max >= 99999999 ? remaining : Math.min(remaining, s.max - prevMax);
        const sliceComm = (span * s.rate) / 100;
        total += sliceComm;
        parts.push(`${formatINR(span)}×${s.rate}%`);
        remaining -= span;
        prevMax = s.max;
      }
      return { commission: total, breakdown: `Marginal (${parts.join(" + ")}) = ${formatINR(total)}` };
    }
    case "D": {
      const target = Number(policy.targetAmount) || 500000;
      const bonus = Number(policy.targetBonus) || 25000;
      const achieved = sales >= target;
      return {
        commission: achieved ? bonus : 0,
        breakdown: `Target ${formatINR(target)} vs ${formatINR(sales)} → ${achieved ? `Bonus ${formatINR(bonus)}` : "Not met"}`,
      };
    }
    case "E": {
      const rate = product.toLowerCase().includes("enterprise") ? 8 : 4;
      const comm = (sales * rate) / 100;
      return { commission: comm, breakdown: `${product} (${rate}%) on ${formatINR(sales)} = ${formatINR(comm)}` };
    }
    case "F": {
      const rate = Number(policy.rate) || 5;
      const comm = (sales * rate) / 100;
      return { commission: comm, breakdown: `Referral ${formatINR(sales)} × ${rate}% = ${formatINR(comm)}` };
    }
    case "G": {
      const pool = (sales * (Number(policy.rate) || 10)) / 100;
      return {
        commission: pool,
        breakdown: `Pool ${formatINR(pool)} → Rep 70% (${formatINR(pool * 0.7)}), Mgr 20% (${formatINR(pool * 0.2)}), Partner 10% (${formatINR(pool * 0.1)})`,
      };
    }
    default:
      return { commission: 0, breakdown: "Custom rule" };
  }
}

// ============================================================================
// LOGIN PORTAL (ADMIN / EMPLOYEE / PARTNER)
// ============================================================================
function LoginScreen({ onLogin, org }) {
  const [role, setRole] = useState("admin");
  const [form, setForm] = useState({
    name: "Kattamanchi Harika",
    email: "harika@alphaauron.com",
    password: "••••••••",
  });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");

  const roleMeta = {
    admin: {
      title: "Admin Portal",
      tag: "Admin login",
      sub: "Full access — manage users, policies, approvals, payouts and admin controls.",
      icon: ShieldCheck,
    },
    employee: {
      title: "Employee Portal",
      tag: "Employee login",
      sub: "Sign in with your work e-mail and password. View statements, log sales and raise disputes.",
      icon: UserCheck,
    },
    user: {
      title: "Partner Portal",
      tag: "Partner login",
      sub: "Sign in to see your own sales, commissions, statements and payouts.",
      icon: Users,
    },
  }[role];
  const Icon = roleMeta.icon;

  const selectRole = (nextRole) => {
    setRole(nextRole);
    setError("");
    if (nextRole === "admin") {
      setForm({ name: "Kattamanchi Harika", email: "harika@alphaauron.com", password: "••••••••" });
    } else if (nextRole === "employee") {
      setForm({ name: "Priya Sharma", email: "priya@alphaauron.com", password: "••••••••" });
    } else {
      setForm({ name: "Kiran Partner", email: "kiran@partnerhub.in", password: "••••••••" });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError("Please enter your full name.");
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return setError("Please enter a valid email address.");
    if (form.password.length < 4) return setError("Password must be at least 4 characters.");
    onLogin({ name: form.name.trim(), email: form.email.trim(), role });
  };

  const inputClass =
    "w-full rounded-xl border border-[#2C2C32] bg-[#141417] pl-10 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-red-500 focus:ring-4 focus:ring-red-500/15 focus:outline-none transition";

  return (
    <div className="min-h-screen flex flex-col bg-[#070708] text-slate-100 font-sans antialiased">
      <div className="flex-1 grid lg:grid-cols-2">
        {/* Left Crimson Panel */}
        <div className="relative overflow-hidden flex flex-col justify-between p-8 sm:p-12 text-white bg-gradient-to-br from-[#2B0606] via-[#5E1111] to-[#7F1717]">
          <div className="pointer-events-none absolute -top-24 -left-24 w-96 h-96 rounded-full bg-red-500/15 blur-3xl" />
          <div className="pointer-events-none hidden sm:block absolute top-1/2 left-[63%] -translate-y-1/2 w-24 h-24 rounded-2xl bg-white/[0.06] border border-white/10 rotate-6" />

          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center font-extrabold text-xs">
              AC
            </div>
            <div className="text-lg font-extrabold tracking-tight">Auron CommissionOS</div>
          </div>

          <div className="relative space-y-6 max-w-md my-8">
            <h1 className="text-4xl font-extrabold leading-tight">
              Every commission, calculated and paid with confidence.
            </h1>
            <ul className="space-y-3 text-sm text-rose-50/90">
              {[
                "7 commission models with transparent formulas",
                "Approvals, payouts and reconciliation in one flow",
                "Admin edits everything · employees get limited edit · users view only",
              ].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-rose-200/80 shrink-0" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative text-xs text-rose-200/75">Sales incentive operations platform</div>
        </div>

        {/* Right Login Card */}
        <div className="flex items-center justify-center p-6 sm:p-10 bg-[#08080A]">
          <div className="w-full max-w-md bg-[#101013] rounded-3xl shadow-2xl border border-[#222227] p-8 space-y-5">
            {/* Portal Switcher */}
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#18181D] border border-[#26262E] text-xs font-bold">
              {[
                { id: "admin", label: "Admin" },
                { id: "employee", label: "Employee" },
                { id: "user", label: "Partner" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => selectRole(tab.id)}
                  className={`py-2 rounded-lg transition ${
                    role === tab.id ? "bg-red-600 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-[#2A1012] border border-red-900/60 text-red-500 flex items-center justify-center shrink-0">
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-red-950/80 text-red-400 border border-red-900/60">
                  {roleMeta.tag}
                </span>
                <h2 className="text-xl font-extrabold text-white mt-1">{roleMeta.title}</h2>
              </div>
            </div>

            <p className="text-xs text-slate-400">{roleMeta.sub}</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Full name"
                  className={`${inputClass} pr-3.5`}
                />
              </div>

              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="Email address"
                  className={`${inputClass} pr-3.5`}
                />
              </div>

              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPw ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Password"
                  className={`${inputClass} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-200"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {error && (
                <div className="rounded-xl bg-red-950/60 border border-red-800/70 text-red-300 text-xs font-semibold px-3.5 py-2.5">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#DC2626] to-[#B91C1C] hover:from-[#EF4444] hover:to-[#DC2626] text-white text-sm font-bold shadow-lg shadow-red-950/60 flex items-center justify-center gap-2 transition"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign In</span>
              </button>
            </form>

            <p className="text-[11px] text-slate-500 text-center">
              Need access? Contact{" "}
              <a
                href={`mailto:${org.contact.email}`}
                className="text-slate-300 hover:text-red-400 underline underline-offset-2"
              >
                {org.contact.email}
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#222227] bg-[#0B0B0D] text-slate-300">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#27272A] border border-[#3F3F46] text-white flex items-center justify-center font-extrabold text-[11px]">
                AC
              </div>
              <span className="text-sm font-bold text-white">Auron CommissionOS</span>
            </div>
            <p className="text-slate-400 max-w-xs">
              Commission calculation, approvals, payouts and analytics — one workspace for sales incentive operations.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Support</div>
            <div className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-red-500" /> {org.contact.email}
            </div>
            <div className="flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-sky-400" /> +91 9000029580
            </div>
            <div className="flex items-center gap-2">
              <MessageCircle className="w-3.5 h-3.5 text-emerald-400" /> WhatsApp
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Office Hours</div>
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-amber-400" /> {org.contact.hours}
            </div>
            <div className="text-slate-400 pl-5">{org.contact.days}</div>
            <div className="flex items-center gap-2 text-slate-400">
              <MapPin className="w-3.5 h-3.5 text-rose-500" /> {org.address}
            </div>
          </div>
        </div>
        <div className="border-t border-[#1D1D22] py-3 px-4 text-center text-[11px] text-slate-500">
          © 2026 {org.name} · All rights reserved · Auron CommissionOS v1.0
        </div>
      </footer>
    </div>
  );
}

// ============================================================================
// MAIN APPLICATION (ALL 12 MODULES + ADMIN CONTROLS + RAZORPAY/QR BILLING)
// ============================================================================
export default function App() {
  const [user, setUser] = useLocalState("session", null);
  const [activeModule, setActiveModule] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [toast, setToast] = useState(null);

  // Core 12-Module Persisted States
  const [org, setOrg] = useLocalState("org", INITIAL_ORG);
  const [departments, setDepartments] = useLocalState("departments", INITIAL_DEPARTMENTS);
  const [employees, setEmployees] = useLocalState("employees", INITIAL_EMPLOYEES);
  const [policies, setPolicies] = useLocalState("policies", INITIAL_POLICIES);
  const [transactions, setTransactions] = useLocalState("transactions", INITIAL_TRANSACTIONS);
  const [reversals, setReversals] = useLocalState("reversals", INITIAL_REVERSALS);
  const [statements, setStatements] = useLocalState("statements", INITIAL_STATEMENTS);
  const [payouts, setPayouts] = useLocalState("payouts", INITIAL_PAYOUTS);
  const [disputes, setDisputes] = useLocalState("disputes", INITIAL_DISPUTES);
  const [currentPlan, setCurrentPlan] = useLocalState("plan", "business");
  const [auditLogs, setAuditLogs] = useLocalState("audit", [
    { id: "AUD-01", actor: "System", action: "Initialized 12-module CommissionOS workspace", time: "26 Nov 2026, 09:30 AM" },
  ]);

  const notify = (msg, type = "success") => {
    setToast({ msg, type });
    setAuditLogs((prev) => [
      {
        id: `AUD-${Date.now().toString().slice(-4)}`,
        actor: user?.name || "Admin",
        action: msg,
        time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      },
      ...prev.slice(0, 29),
    ]);
    setTimeout(() => setToast(null), 3500);
  };

  // Support URL hash /#admin-panel
  useEffect(() => {
    const syncHash = () => {
      if (window.location.hash === "#admin-panel") {
        setActiveModule("admin");
      }
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  // Role-based visible records
  const isAdmin = user?.role === "admin";
  const isPartner = user?.role === "user";
  const visibleTxns = useMemo(
    () => (isPartner ? transactions.filter((t) => t.salesperson === user.name) : transactions),
    [transactions, isPartner, user],
  );
  const visibleStatements = useMemo(
    () => (isPartner ? statements.filter((s) => s.employeeName === user.name) : statements),
    [statements, isPartner, user],
  );
  const visiblePayouts = useMemo(
    () => (isPartner ? payouts.filter((p) => p.employeeName === user.name) : payouts),
    [payouts, isPartner, user],
  );

  // KPI Metrics
  const metrics = useMemo(() => {
    const totalSales = visibleTxns.reduce((sum, t) => sum + Number(t.eligibleBase || 0), 0);
    const totalPayable = visibleStatements.reduce((sum, s) => sum + Number(s.netPayable || 0), 0);
    const paidTotal = visiblePayouts
      .filter((p) => p.status === "Reconciled")
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const openDisputes = disputes.filter((d) => d.status !== "Resolved").length;
    return { totalSales, totalPayable, paidTotal, openDisputes };
  }, [visibleTxns, visibleStatements, visiblePayouts, disputes]);

  const MODULES = [
    { id: "dashboard", label: "1. Executive Dashboard", icon: LayoutDashboard },
    { id: "org", label: "2. Org & Departments", icon: Building2 },
    { id: "users", label: "3. Team & Partners", icon: Users },
    { id: "transactions", label: "4. Sales Transactions", icon: FileSpreadsheet },
    { id: "policies", label: "5. Commission Engine", icon: Calculator },
    { id: "reversals", label: "6. Reversals & Clawbacks", icon: RotateCcw },
    { id: "statements", label: "7. Statements & Certs", icon: FileText },
    { id: "approvals", label: "8. 7-Stage Approvals", icon: CheckCircle2 },
    { id: "payouts", label: "9. Payouts & Bank Sync", icon: Wallet },
    { id: "disputes", label: "10. Disputes Portal", icon: AlertTriangle },
    { id: "reports", label: "11. Analytics & Reports", icon: BarChart3 },
    { id: "admin", label: "12. Admin & Billing", icon: ShieldCheck },
  ];

  // Download Printable HTML Certificate / Statement
  const downloadCertificate = (stmt) => {
    const html = `<!doctype html><html><head><title>Commission Certificate - ${stmt.id}</title>
    <style>body{font-family:Arial,sans-serif;background:#0a0a0c;color:#f8fafc;padding:40px}
    .card{max-width:720px;margin:auto;border:2px solid #dc2626;border-radius:16px;padding:36px;background:#121216}
    h1{color:#ef4444;margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:20px}
    td,th{border:1px solid #27272a;padding:10px;text-align:left}.total{font-size:20px;font-weight:bold;color:#4ade80}</style>
    </head><body><div class="card"><h1>${org.name}</h1><p>Official Commission Statement & Payout Certificate</p>
    <hr style="border-color:#27272a"/><p><strong>Statement ID:</strong> ${stmt.id} | <strong>Period:</strong> ${stmt.period}</p>
    <p><strong>Recipient:</strong> ${stmt.employeeName} (${stmt.employeeId})</p>
    <table><tr><th>Component</th><th>Amount (INR)</th></tr>
    <tr><td>Eligible Gross Sales</td><td>${formatINR(stmt.grossSales)}</td></tr>
    <tr><td>Calculated Commission</td><td>${formatINR(stmt.grossCommission)}</td></tr>
    <tr><td>Clawbacks / Reversals</td><td>-${formatINR(stmt.clawbacks)}</td></tr>
    <tr><td>Manual Adjustments</td><td>+${formatINR(stmt.adjustments)}</td></tr>
    <tr><td><strong>Net Commission Payable</strong></td><td class="total">${formatINR(stmt.netPayable)}</td></tr></table>
    <p style="margin-top:24px;font-size:12px;color:#94a3b8">Status: ${stmt.status} · Verified by Auron CommissionOS</p>
    </div></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${stmt.id}_Certificate.html`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Downloaded certificate ${stmt.id}_Certificate.html`);
  };

  // Interactive Calculator State (Module 5)
  const [simPolicyId, setSimPolicyId] = useState("POL003");
  const [simSales, setSimSales] = useState(425000);
  const [simCount, setSimCount] = useState(3);
  const [simProduct, setSimProduct] = useState("CommissionOS Enterprise");
  const [newPolicy, setNewPolicy] = useState({ name: "", model: "A", rate: 6, fixedAmount: 5000 });

  // Module 4 Manual Txn Form
  const [txnForm, setTxnForm] = useState({
    invoiceNumber: `INV-2026-100${transactions.length + 1}`,
    customer: "",
    product: "CommissionOS Enterprise",
    invoiceAmount: 150000,
    discount: 5000,
    salesperson: "Rahul Verma",
  });

  // Module 6 Reversal Form
  const [revForm, setRevForm] = useState({
    txnId: "TXN001",
    reason: "Customer Partial Refund",
    refundAmount: 50000,
    ratePct: 5,
  });

  // Module 10 Dispute Form
  const [disputeForm, setDisputeForm] = useState({
    statementId: "STMT-2026-11-01",
    category: "Rate Calculation",
    claimedDelta: 2000,
    description: "",
  });

  // Module 12 Payment Modal (Razorpay / UPI QR)
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  const [utrInput, setUtrInput] = useState("");

  if (!user) {
    return <LoginScreen onLogin={setUser} org={org} />;
  }

  const surface = darkMode
    ? "bg-[#121216] border-[#24242A] text-slate-100"
    : "bg-white border-slate-200 text-slate-900";
  const subSurface = darkMode
    ? "bg-[#18181E] border-[#2B2B33] text-slate-200"
    : "bg-slate-50 border-slate-200 text-slate-800";
  const inputDark = darkMode
    ? "rounded-xl border border-[#2C2C33] bg-[#18181D] text-white px-3 py-2 text-xs focus:border-red-500 focus:outline-none"
    : "rounded-xl border border-slate-300 bg-white text-slate-900 px-3 py-2 text-xs focus:border-red-600 focus:outline-none";

  const activeSimPolicy = policies.find((p) => p.id === simPolicyId) || policies[0];
  const simResult = computePolicyCommission(activeSimPolicy, simSales, simCount, simProduct);

  return (
    <div
      className={`min-h-screen flex ${
        darkMode ? "bg-[#070709] text-slate-100" : "bg-slate-100 text-slate-900"
      } font-sans antialiased`}
    >
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl border text-xs font-bold flex items-center gap-2 ${
            toast.type === "error"
              ? "bg-red-950 border-red-700 text-red-200"
              : "bg-[#141418] border-red-600 text-white"
          }`}
        >
          <CheckCircle2 className="w-4 h-4 text-red-500 shrink-0" />
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Left Sidebar Navigation (12 Modules) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform transition-transform lg:static lg:translate-x-0 flex flex-col border-r ${
          darkMode ? "bg-[#0C0C0F] border-[#1F1F26]" : "bg-slate-900 border-slate-800 text-white"
        } ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="p-5 border-b border-[#1F1F26] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-red-800 text-white flex items-center justify-center font-extrabold text-xs">
              AC
            </div>
            <div>
              <div className="text-sm font-extrabold text-white tracking-tight">CommissionOS</div>
              <div className="text-[10px] text-red-400 font-semibold uppercase">
                {SAAS_PLANS.find((p) => p.id === currentPlan)?.name} Edition
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {MODULES.map((m) => {
            const Icon = m.icon;
            const active = activeModule === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setActiveModule(m.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition text-left ${
                  active
                    ? "bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-950/50"
                    : "text-slate-400 hover:bg-[#16161C] hover:text-slate-100"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{m.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#1F1F26] space-y-3 text-xs">
          <div className="p-3 rounded-xl bg-[#141419] border border-[#24242D]">
            <div className="font-bold text-white truncate">{user.name}</div>
            <div className="text-[11px] text-slate-400 truncate">{user.email}</div>
            <span className="inline-block mt-1.5 px-2 py-0.5 rounded bg-red-950 text-red-400 border border-red-900/60 text-[10px] font-extrabold uppercase">
              {user.role === "user" ? "Partner" : user.role}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setUser(null)}
            className="w-full py-2 rounded-xl bg-[#191920] hover:bg-red-950/60 text-slate-300 hover:text-red-300 font-bold flex items-center justify-center gap-2 transition"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header
          className={`sticky top-0 z-30 px-4 sm:px-8 py-4 border-b backdrop-blur-md flex items-center justify-between gap-4 ${
            darkMode ? "bg-[#0A0A0D]/90 border-[#1F1F26]" : "bg-white/90 border-slate-200"
          }`}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl border border-[#282830]"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-extrabold tracking-tight">
                {MODULES.find((m) => m.id === activeModule)?.label}
              </h1>
              <p className="text-[11px] text-slate-400">{org.name} · Cycle: {org.cycle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              className="p-2 rounded-xl border border-[#2C2C35] hover:border-red-500 transition"
              title="Toggle theme"
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  window.location.hash = "#admin-panel";
                  setActiveModule("admin");
                }}
                className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5" /> Admin Panel
              </button>
            )}
          </div>
        </header>

        {/* Active Module Viewport */}
        <main className="flex-1 p-4 sm:p-8 max-w-[1440px] w-full mx-auto space-y-6">
          {/* MODULE 1: EXECUTIVE DASHBOARD */}
          {activeModule === "dashboard" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  { label: "Eligible Sales Volume", value: formatINR(metrics.totalSales), sub: `${visibleTxns.length} active deals`, accent: "text-white" },
                  { label: "Net Commission Payable", value: formatINR(metrics.totalPayable), sub: `${visibleStatements.length} statements`, accent: "text-red-400" },
                  { label: "Reconciled Bank Payouts", value: formatINR(metrics.paidTotal), sub: "UTR verified", accent: "text-emerald-400" },
                  { label: "Open Disputes", value: metrics.openDisputes, sub: "SLA < 48 hrs", accent: "text-amber-400" },
                ].map((kpi) => (
                  <div key={kpi.label} className={`rounded-2xl border p-5 ${surface}`}>
                    <div className="text-xs text-slate-400 font-semibold">{kpi.label}</div>
                    <div className={`text-2xl font-extrabold mt-2 ${kpi.accent}`}>{kpi.value}</div>
                    <div className="text-[11px] text-slate-500 mt-1">{kpi.sub}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className={`lg:col-span-2 rounded-2xl border p-6 space-y-4 ${surface}`}>
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-extrabold">Recent Commission Statements</h2>
                    <button
                      type="button"
                      onClick={() => setActiveModule("statements")}
                      className="text-xs font-bold text-red-400 hover:underline"
                    >
                      View All →
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#24242C] text-slate-400 uppercase text-[11px]">
                          <th className="py-2.5">Statement</th>
                          <th className="py-2.5">Recipient</th>
                          <th className="py-2.5 text-right">Net Payable</th>
                          <th className="py-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1E1E24]">
                        {visibleStatements.map((s) => (
                          <tr key={s.id}>
                            <td className="py-3 font-bold text-red-400">{s.id}</td>
                            <td className="py-3">{s.employeeName}</td>
                            <td className="py-3 text-right font-bold">{formatINR(s.netPayable)}</td>
                            <td className="py-3">
                              <span className="px-2.5 py-0.5 rounded-full bg-red-950/80 text-red-300 border border-red-900/60 font-semibold">
                                {s.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className={`rounded-2xl border p-6 space-y-3 ${surface}`}>
                  <h2 className="text-sm font-extrabold">Live Audit Trail</h2>
                  <div className="space-y-3 text-xs">
                    {auditLogs.slice(0, 6).map((log) => (
                      <div key={log.id} className={`p-3 rounded-xl border ${subSurface}`}>
                        <div className="font-bold text-red-400">{log.actor}</div>
                        <div className="text-slate-300 mt-0.5">{log.action}</div>
                        <div className="text-[10px] text-slate-500 mt-1">{log.time}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MODULE 2: ORGANIZATION & DEPARTMENTS */}
          {activeModule === "org" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
              <div className={`rounded-2xl border p-6 space-y-4 ${surface}`}>
                <h2 className="text-base font-extrabold">Organization Profile</h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-slate-400 mb-1">Company Legal Name</label>
                    <input
                      disabled={!isAdmin}
                      value={org.name}
                      onChange={(e) => setOrg({ ...org, name: e.target.value })}
                      className={`w-full ${inputDark}`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1">GSTIN</label>
                      <input
                        disabled={!isAdmin}
                        value={org.gstin}
                        onChange={(e) => setOrg({ ...org, gstin: e.target.value })}
                        className={`w-full ${inputDark}`}
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Payout Cycle</label>
                      <select
                        disabled={!isAdmin}
                        value={org.cycle}
                        onChange={(e) => setOrg({ ...org, cycle: e.target.value })}
                        className={`w-full ${inputDark}`}
                      >
                        <option>Monthly</option>
                        <option>Bi-Weekly</option>
                        <option>Quarterly</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Registered Office</label>
                    <input
                      disabled={!isAdmin}
                      value={org.address}
                      onChange={(e) => setOrg({ ...org, address: e.target.value })}
                      className={`w-full ${inputDark}`}
                    />
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => notify("Organization settings saved.")}
                      className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold"
                    >
                      Save Organization Profile
                    </button>
                  )}
                </div>
              </div>

              <div className={`rounded-2xl border p-6 space-y-4 ${surface}`}>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold">Departments & Quotas</h2>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = {
                          id: `DEPT0${departments.length + 1}`,
                          name: `Strategic Accounts ${departments.length + 1}`,
                          head: "Kattamanchi Harika",
                          target: 1200000,
                          active: true,
                        };
                        setDepartments([...departments, next]);
                        notify(`Added department ${next.name}`);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-red-600 text-white font-bold flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Dept
                    </button>
                  )}
                </div>
                <div className="space-y-2.5">
                  {departments.map((d) => (
                    <div key={d.id} className={`p-3.5 rounded-xl border flex items-center justify-between ${subSurface}`}>
                      <div>
                        <div className="font-bold text-sm">{d.name}</div>
                        <div className="text-slate-400">Head: {d.head} · Target: {formatINR(d.target)}</div>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-bold">
                        Active
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* MODULE 3: TEAM & PARTNERS */}
          {activeModule === "users" && (
            <div className={`rounded-2xl border p-6 space-y-4 text-xs ${surface}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-extrabold">Sales Team & Channel Partners ({employees.length})</h2>
                  <p className="text-slate-400">Policy mappings, bank payout accounts, and portal access roles.</p>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      const emp = {
                        id: `EMP00${employees.length + 1}`,
                        name: `Associate ${employees.length + 1}`,
                        email: `rep${employees.length + 1}@alphaauron.com`,
                        role: "Account Executive",
                        portalRole: "employee",
                        department: "Inbound Growth",
                        policyId: "POL001",
                        bankAccount: "AXIS •••• 3109",
                        ifsc: "UTIB0000114",
                        status: "Active",
                      };
                      setEmployees([...employees, emp]);
                      notify(`Added ${emp.name} (${emp.id})`);
                    }}
                    className="px-4 py-2 rounded-xl bg-red-600 text-white font-bold flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Member
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-[#24242C] text-slate-400 uppercase text-[11px]">
                      <th className="py-3 px-2">ID</th>
                      <th className="py-3 px-2">Name & Email</th>
                      <th className="py-3 px-2">Role</th>
                      <th className="py-3 px-2">Department</th>
                      <th className="py-3 px-2">Assigned Policy</th>
                      <th className="py-3 px-2">Bank Account</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E1E24]">
                    {employees.map((e) => (
                      <tr key={e.id}>
                        <td className="py-3 px-2 font-bold text-red-400">{e.id}</td>
                        <td className="py-3 px-2">
                          <div className="font-bold">{e.name}</div>
                          <div className="text-slate-400">{e.email}</div>
                        </td>
                        <td className="py-3 px-2">{e.role}</td>
                        <td className="py-3 px-2">{e.department}</td>
                        <td className="py-3 px-2 font-semibold text-amber-400">{e.policyId}</td>
                        <td className="py-3 px-2 font-mono">{e.bankAccount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MODULE 4: SALES TRANSACTIONS */}
          {activeModule === "transactions" && (
            <div className="space-y-6 text-xs">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!txnForm.customer.trim()) return notify("Enter customer name.", "error");
                  const eligible = Math.max(0, Number(txnForm.invoiceAmount) - Number(txnForm.discount));
                  const created = {
                    id: `TXN00${transactions.length + 1}`,
                    invoiceNumber: txnForm.invoiceNumber,
                    customer: txnForm.customer,
                    product: txnForm.product,
                    date: "26-11-2026",
                    invoiceAmount: Number(txnForm.invoiceAmount),
                    discount: Number(txnForm.discount),
                    eligibleBase: eligible,
                    salesperson: isPartner ? user.name : txnForm.salesperson,
                    salespersonId: "EMP001",
                    department: "Enterprise Sales",
                    status: isAdmin ? "Eligible" : "Pending Validation",
                  };
                  setTransactions([created, ...transactions]);
                  setTxnForm({
                    ...txnForm,
                    invoiceNumber: `INV-2026-100${transactions.length + 2}`,
                    customer: "",
                  });
                  notify(`Recorded ${created.invoiceNumber} (${formatINR(eligible)} eligible base).`);
                }}
                className={`rounded-2xl border p-5 space-y-4 ${surface}`}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-extrabold">Log New Sales Transaction</h2>
                  <button
                    type="button"
                    onClick={() =>
                      downloadCSV(
                        "Sales_Transactions.csv",
                        ["ID", "Invoice", "Customer", "Salesperson", "EligibleBase", "Status"],
                        visibleTxns.map((t) => [t.id, t.invoiceNumber, t.customer, t.salesperson, t.eligibleBase, t.status]),
                      )
                    }
                    className="px-3 py-1.5 rounded-xl bg-[#1E1E26] text-slate-200 font-bold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" /> Export CSV
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                  <input
                    value={txnForm.invoiceNumber}
                    onChange={(e) => setTxnForm({ ...txnForm, invoiceNumber: e.target.value })}
                    placeholder="Invoice #"
                    className={inputDark}
                  />
                  <input
                    value={txnForm.customer}
                    onChange={(e) => setTxnForm({ ...txnForm, customer: e.target.value })}
                    placeholder="Customer Name *"
                    className={inputDark}
                  />
                  <input
                    type="number"
                    value={txnForm.invoiceAmount}
                    onChange={(e) => setTxnForm({ ...txnForm, invoiceAmount: e.target.value })}
                    placeholder="Amount ₹"
                    className={inputDark}
                  />
                  <input
                    type="number"
                    value={txnForm.discount}
                    onChange={(e) => setTxnForm({ ...txnForm, discount: e.target.value })}
                    placeholder="Discount ₹"
                    className={inputDark}
                  />
                  <button
                    type="submit"
                    className="py-2 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold"
                  >
                    + Add Sale
                  </button>
                </div>
              </form>

              <div className={`rounded-2xl border overflow-hidden ${surface}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-[#24242C] bg-[#16161C] text-slate-400 uppercase text-[11px]">
                        <th className="py-3 px-3">TXN</th>
                        <th className="py-3 px-3">Invoice</th>
                        <th className="py-3 px-3">Customer</th>
                        <th className="py-3 px-3">Owner</th>
                        <th className="py-3 px-3 text-right">Invoice Amt</th>
                        <th className="py-3 px-3 text-right">Eligible Base</th>
                        <th className="py-3 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E1E24]">
                      {visibleTxns.map((t) => (
                        <tr key={t.id}>
                          <td className="py-3 px-3 font-bold text-red-400">{t.id}</td>
                          <td className="py-3 px-3 font-semibold">{t.invoiceNumber}</td>
                          <td className="py-3 px-3">{t.customer}</td>
                          <td className="py-3 px-3">{t.salesperson}</td>
                          <td className="py-3 px-3 text-right">{formatINR(t.invoiceAmount)}</td>
                          <td className="py-3 px-3 text-right font-bold">{formatINR(t.eligibleBase)}</td>
                          <td className="py-3 px-3">
                            <select
                              disabled={!isAdmin}
                              value={t.status}
                              onChange={(e) => {
                                setTransactions(
                                  transactions.map((x) => (x.id === t.id ? { ...x, status: e.target.value } : x)),
                                );
                                notify(`Updated ${t.id} status to ${e.target.value}`);
                              }}
                              className={inputDark}
                            >
                              {["Pending Validation", "Validated", "Eligible", "On Hold", "Reversed"].map((st) => (
                                <option key={st}>{st}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* MODULE 5: 7-MODEL COMMISSION ENGINE */}
          {activeModule === "policies" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
              <div className={`lg:col-span-2 rounded-2xl border p-6 space-y-4 ${surface}`}>
                <h2 className="text-base font-extrabold">Active Commission Policies (7-Model Engine)</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {policies.map((p) => (
                    <div key={p.id} className={`p-4 rounded-xl border space-y-1.5 ${subSurface}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-red-400">{p.id}</span>
                        <span className="px-2 py-0.5 rounded bg-red-950 text-red-300 text-[10px] font-bold">
                          {p.modelLabel}
                        </span>
                      </div>
                      <div className="font-bold text-sm">{p.name}</div>
                      <div className="text-slate-400">
                        {p.rate ? `Base Rate: ${p.rate}%` : p.fixedAmount ? `Per Sale: ${formatINR(p.fixedAmount)}` : "Progressive / Target Rule"}
                      </div>
                    </div>
                  ))}
                </div>

                {isAdmin && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newPolicy.name.trim()) return;
                      const created = {
                        id: `POL00${policies.length + 1}`,
                        name: newPolicy.name,
                        model: newPolicy.model,
                        modelLabel: `Model ${newPolicy.model}`,
                        rate: Number(newPolicy.rate),
                        fixedAmount: Number(newPolicy.fixedAmount),
                        status: "Active",
                      };
                      setPolicies([...policies, created]);
                      setNewPolicy({ ...newPolicy, name: "" });
                      notify(`Created policy ${created.id}: ${created.name}`);
                    }}
                    className="pt-4 border-t border-[#22222A] grid grid-cols-1 sm:grid-cols-4 gap-3"
                  >
                    <input
                      value={newPolicy.name}
                      onChange={(e) => setNewPolicy({ ...newPolicy, name: e.target.value })}
                      placeholder="New policy name"
                      className={`sm:col-span-2 ${inputDark}`}
                    />
                    <select
                      value={newPolicy.model}
                      onChange={(e) => setNewPolicy({ ...newPolicy, model: e.target.value })}
                      className={inputDark}
                    >
                      <option value="A">Model A: Fixed %</option>
                      <option value="B">Model B: Per-Sale</option>
                      <option value="C">Model C: Marginal Slabs</option>
                      <option value="D">Model D: Target Bonus</option>
                      <option value="E">Model E: Product Rate</option>
                      <option value="F">Model F: Referral</option>
                      <option value="G">Model G: Multi-Level Split</option>
                    </select>
                    <button type="submit" className="py-2 px-4 rounded-xl bg-red-600 text-white font-bold">
                      + Add Rule
                    </button>
                  </form>
                )}
              </div>

              {/* Live Formula Simulator */}
              <div className={`rounded-2xl border p-6 space-y-4 ${surface}`}>
                <h2 className="text-base font-extrabold flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-red-500" /> Live Commission Simulator
                </h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-slate-400 mb-1">Select Policy</label>
                    <select
                      value={simPolicyId}
                      onChange={(e) => setSimPolicyId(e.target.value)}
                      className={`w-full ${inputDark}`}
                    >
                      {policies.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Eligible Sales Amount (₹)</label>
                    <input
                      type="number"
                      value={simSales}
                      onChange={(e) => setSimSales(Number(e.target.value))}
                      className={`w-full ${inputDark}`}
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Closed Deal Count</label>
                    <input
                      type="number"
                      value={simCount}
                      onChange={(e) => setSimCount(Number(e.target.value))}
                      className={`w-full ${inputDark}`}
                    />
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 space-y-1">
                  <div className="text-[11px] uppercase font-bold text-red-300">Calculated Payout</div>
                  <div className="text-2xl font-extrabold text-white">{formatINR(simResult.commission)}</div>
                  <div className="text-[11px] text-slate-300">{simResult.breakdown}</div>
                </div>
              </div>
            </div>
          )}

          {/* MODULE 6: REVERSALS & CLAWBACKS */}
          {activeModule === "reversals" && (
            <div className="space-y-6 text-xs">
              {isAdmin && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const txn = transactions.find((t) => t.id === revForm.txnId) || transactions[0];
                    const clawback = Math.round((Number(revForm.refundAmount) * Number(revForm.ratePct)) / 100);
                    const created = {
                      id: `REV00${reversals.length + 1}`,
                      txnId: txn.id,
                      invoiceNumber: txn.invoiceNumber,
                      salesperson: txn.salesperson,
                      reason: revForm.reason,
                      refundAmount: Number(revForm.refundAmount),
                      clawbackAmount: clawback,
                      date: "26-11-2026",
                      status: "Applied",
                    };
                    setReversals([created, ...reversals]);
                    notify(`Clawback ${created.id} (${formatINR(clawback)}) applied against ${txn.salesperson}.`);
                  }}
                  className={`rounded-2xl border p-5 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end ${surface}`}
                >
                  <div>
                    <label className="block text-slate-400 mb-1">Transaction</label>
                    <select
                      value={revForm.txnId}
                      onChange={(e) => setRevForm({ ...revForm, txnId: e.target.value })}
                      className={`w-full ${inputDark}`}
                    >
                      {transactions.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.id} ({t.salesperson})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Reason</label>
                    <input
                      value={revForm.reason}
                      onChange={(e) => setRevForm({ ...revForm, reason: e.target.value })}
                      className={`w-full ${inputDark}`}
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Refund Amount (₹)</label>
                    <input
                      type="number"
                      value={revForm.refundAmount}
                      onChange={(e) => setRevForm({ ...revForm, refundAmount: e.target.value })}
                      className={`w-full ${inputDark}`}
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Clawback Rate (%)</label>
                    <input
                      type="number"
                      value={revForm.ratePct}
                      onChange={(e) => setRevForm({ ...revForm, ratePct: e.target.value })}
                      className={`w-full ${inputDark}`}
                    />
                  </div>
                  <button type="submit" className="py-2 px-4 rounded-xl bg-red-600 text-white font-bold">
                    Record Clawback
                  </button>
                </form>
              )}

              <div className={`rounded-2xl border overflow-hidden ${surface}`}>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-[#24242C] bg-[#16161C] text-slate-400 uppercase text-[11px]">
                      <th className="py-3 px-4">Reversal ID</th>
                      <th className="py-3 px-4">Invoice</th>
                      <th className="py-3 px-4">Salesperson</th>
                      <th className="py-3 px-4">Reason</th>
                      <th className="py-3 px-4 text-right">Refund</th>
                      <th className="py-3 px-4 text-right">Commission Clawback</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E1E24]">
                    {reversals.map((r) => (
                      <tr key={r.id}>
                        <td className="py-3 px-4 font-bold text-red-400">{r.id}</td>
                        <td className="py-3 px-4">{r.invoiceNumber}</td>
                        <td className="py-3 px-4">{r.salesperson}</td>
                        <td className="py-3 px-4">{r.reason}</td>
                        <td className="py-3 px-4 text-right">{formatINR(r.refundAmount)}</td>
                        <td className="py-3 px-4 text-right font-bold text-rose-400">−{formatINR(r.clawbackAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MODULE 7: MONTHLY STATEMENTS & CERTIFICATES */}
          {activeModule === "statements" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
              {visibleStatements.map((s) => (
                <div key={s.id} className={`rounded-2xl border p-6 space-y-4 ${surface}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold text-red-400">{s.id}</div>
                      <div className="text-base font-extrabold mt-0.5">{s.employeeName}</div>
                      <div className="text-slate-400">{s.period}</div>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-bold">
                      {s.status}
                    </span>
                  </div>
                  <div className={`p-3.5 rounded-xl border space-y-1.5 ${subSurface}`}>
                    <div className="flex justify-between"><span>Gross Sales</span><strong>{formatINR(s.grossSales)}</strong></div>
                    <div className="flex justify-between"><span>Gross Commission</span><strong>{formatINR(s.grossCommission)}</strong></div>
                    <div className="flex justify-between text-rose-400"><span>Clawbacks</span><span>−{formatINR(s.clawbacks)}</span></div>
                    <div className="flex justify-between text-emerald-400"><span>Adjustments</span><span>+{formatINR(s.adjustments)}</span></div>
                    <div className="pt-2 border-t border-[#282832] flex justify-between text-sm font-extrabold">
                      <span>Net Payable</span><span className="text-red-400">{formatINR(s.netPayable)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadCertificate(s)}
                    className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold flex items-center justify-center gap-2"
                  >
                    <Award className="w-4 h-4" /> Download Certificate
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* MODULE 8: 7-STAGE APPROVAL WORKFLOW */}
          {activeModule === "approvals" && (
            <div className="space-y-4 text-xs">
              {visibleStatements.map((s) => (
                <div key={s.id} className={`rounded-2xl border p-6 space-y-4 ${surface}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-red-400">{s.id}</span> ·{" "}
                      <strong className="text-sm">{s.employeeName}</strong> ({formatINR(s.netPayable)})
                    </div>
                    {isAdmin && s.stage < 7 && (
                      <button
                        type="button"
                        onClick={() => {
                          const nextStage = s.stage + 1;
                          setStatements(
                            statements.map((item) =>
                              item.id === s.id
                                ? {
                                    ...item,
                                    stage: nextStage,
                                    status: nextStage === 7 ? "Paid & Locked" : APPROVAL_STAGES[nextStage - 1],
                                    locked: nextStage >= 6,
                                  }
                                : item,
                            ),
                          );
                          notify(`Advanced ${s.id} to ${APPROVAL_STAGES[nextStage - 1]}`);
                        }}
                        className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold"
                      >
                        Approve Next Stage →
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
                    {APPROVAL_STAGES.map((label, idx) => {
                      const done = idx + 1 <= s.stage;
                      return (
                        <div
                          key={label}
                          className={`p-2.5 rounded-xl border text-center font-semibold ${
                            done
                              ? "bg-red-950/60 border-red-700 text-red-200"
                              : "bg-[#16161B] border-[#24242D] text-slate-500"
                          }`}
                        >
                          {label}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* MODULE 9: BANK PAYOUT RECONCILIATION */}
          {activeModule === "payouts" && (
            <div className={`rounded-2xl border overflow-hidden text-xs ${surface}`}>
              <div className="p-5 border-b border-[#24242C] flex items-center justify-between">
                <div>
                  <h2 className="text-base font-extrabold">Bank Disbursement & UTR Reconciliation</h2>
                  <p className="text-slate-400">NEFT / IMPS / RazorpayX payout tracking</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    downloadCSV(
                      "Bank_Payout_Batch.csv",
                      ["PayoutID", "Statement", "Recipient", "Method", "UTR", "Amount", "Status"],
                      visiblePayouts.map((p) => [p.id, p.statementId, p.employeeName, p.method, p.utr, p.amount, p.status]),
                    )
                  }
                  className="px-3.5 py-2 rounded-xl bg-red-600 text-white font-bold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Export Bank Batch
                </button>
              </div>
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#24242C] bg-[#16161C] text-slate-400 uppercase text-[11px]">
                    <th className="py-3 px-4">Payout ID</th>
                    <th className="py-3 px-4">Recipient</th>
                    <th className="py-3 px-4">Method</th>
                    <th className="py-3 px-4">UTR Reference</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E1E24]">
                  {visiblePayouts.map((p) => (
                    <tr key={p.id}>
                      <td className="py-3 px-4 font-bold text-red-400">{p.id}</td>
                      <td className="py-3 px-4">{p.employeeName}</td>
                      <td className="py-3 px-4">{p.method}</td>
                      <td className="py-3 px-4 font-mono">{p.utr}</td>
                      <td className="py-3 px-4 text-right font-bold">{formatINR(p.amount)}</td>
                      <td className="py-3 px-4">
                        {p.status === "Reconciled" ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-bold">
                            Reconciled
                          </span>
                        ) : isAdmin ? (
                          <button
                            type="button"
                            onClick={() => {
                              const utr = `UTR${Date.now().toString().slice(-10)}`;
                              setPayouts(
                                payouts.map((x) => (x.id === p.id ? { ...x, utr, status: "Reconciled" } : x)),
                              );
                              notify(`Marked ${p.id} reconciled with ${utr}`);
                            }}
                            className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-bold"
                          >
                            Mark Reconciled
                          </button>
                        ) : (
                          <span className="text-amber-400 font-semibold">{p.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* MODULE 10: DISPUTES & ADJUSTMENTS PORTAL */}
          {activeModule === "disputes" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!disputeForm.description.trim()) return notify("Enter dispute details.", "error");
                  const created = {
                    id: `DSP-${101 + disputes.length}`,
                    statementId: disputeForm.statementId,
                    raisedBy: user.name,
                    category: disputeForm.category,
                    claimedDelta: Number(disputeForm.claimedDelta),
                    description: disputeForm.description,
                    status: "Under Review",
                    createdAt: "26-11-2026",
                  };
                  setDisputes([created, ...disputes]);
                  setDisputeForm({ ...disputeForm, description: "" });
                  notify(`Dispute ${created.id} logged for review.`);
                }}
                className={`rounded-2xl border p-6 space-y-3 ${surface}`}
              >
                <h2 className="text-base font-extrabold">Raise Commission Dispute</h2>
                <select
                  value={disputeForm.statementId}
                  onChange={(e) => setDisputeForm({ ...disputeForm, statementId: e.target.value })}
                  className={`w-full ${inputDark}`}
                >
                  {statements.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} — {s.employeeName}
                    </option>
                  ))}
                </select>
                <input
                  value={disputeForm.category}
                  onChange={(e) => setDisputeForm({ ...disputeForm, category: e.target.value })}
                  placeholder="Category"
                  className={`w-full ${inputDark}`}
                />
                <input
                  type="number"
                  value={disputeForm.claimedDelta}
                  onChange={(e) => setDisputeForm({ ...disputeForm, claimedDelta: e.target.value })}
                  placeholder="Claimed Difference (₹)"
                  className={`w-full ${inputDark}`}
                />
                <textarea
                  rows={3}
                  value={disputeForm.description}
                  onChange={(e) => setDisputeForm({ ...disputeForm, description: e.target.value })}
                  placeholder="Explain calculation or deal reference..."
                  className={`w-full ${inputDark}`}
                />
                <button type="submit" className="w-full py-2.5 rounded-xl bg-red-600 text-white font-bold">
                  Submit Dispute Ticket
                </button>
              </form>

              <div className="lg:col-span-2 space-y-3">
                {disputes.map((d) => (
                  <div key={d.id} className={`rounded-2xl border p-5 space-y-2 ${surface}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-red-400">{d.id}</span> · <strong>{d.category}</strong> (
                        {d.statementId})
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800/60 font-bold">
                        {d.status}
                      </span>
                    </div>
                    <p className="text-slate-300">{d.description}</p>
                    <div className="flex items-center justify-between pt-2 text-slate-400">
                      <span>
                        Raised by {d.raisedBy} · Delta: <strong className="text-white">{formatINR(d.claimedDelta)}</strong>
                      </span>
                      {isAdmin && d.status !== "Resolved" && (
                        <button
                          type="button"
                          onClick={() => {
                            setDisputes(disputes.map((x) => (x.id === d.id ? { ...x, status: "Resolved" } : x)));
                            notify(`Resolved dispute ${d.id}`);
                          }}
                          className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-bold"
                        >
                          Approve & Resolve
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MODULE 11: EXECUTIVE ANALYTICS & REPORTS */}
          {activeModule === "reports" && (
            <div className="space-y-6 text-xs">
              <div className={`rounded-2xl border p-6 space-y-4 ${surface}`}>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold">Department Attainment & Commission Yield</h2>
                  <button
                    type="button"
                    onClick={() =>
                      downloadCSV(
                        "Executive_Commission_Report.csv",
                        ["Department", "Head", "Target", "Achieved", "Attainment%"],
                        departments.map((d) => {
                          const achieved = transactions
                            .filter((t) => t.department === d.name)
                            .reduce((s, t) => s + Number(t.eligibleBase || 0), 0);
                          return [d.name, d.head, d.target, achieved, `${Math.round((achieved / d.target) * 100)}%`];
                        }),
                      )
                    }
                    className="px-4 py-2 rounded-xl bg-red-600 text-white font-bold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" /> Download Executive CSV
                  </button>
                </div>

                <div className="space-y-4">
                  {departments.map((d) => {
                    const achieved = transactions
                      .filter((t) => t.department === d.name)
                      .reduce((s, t) => s + Number(t.eligibleBase || 0), 0);
                    const pct = Math.min(100, Math.round((achieved / d.target) * 100));
                    return (
                      <div key={d.id} className="space-y-1.5">
                        <div className="flex justify-between font-bold">
                          <span>{d.name} ({d.head})</span>
                          <span>
                            {formatINR(achieved)} / {formatINR(d.target)} ({pct}%)
                          </span>
                        </div>
                        <div className="w-full h-3 rounded-full bg-[#1C1C24] overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-red-600 to-rose-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* MODULE 12: ADMIN CONTROLS, SAAS BILLING & RAZORPAY / UPI QR */}
          {activeModule === "admin" && (
            <div className="space-y-6 text-xs">
              <div className={`rounded-2xl border p-6 space-y-4 ${surface}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-extrabold flex items-center gap-2">
                      <Crown className="w-4 h-4 text-red-500" /> Subscription Plans & Razorpay / UPI QR Billing
                    </h2>
                    <p className="text-slate-400">
                      Current Active Plan: <strong className="text-red-400 uppercase">{currentPlan}</strong>
                    </p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <input
                        value={org.upiId}
                        onChange={(e) => setOrg({ ...org, upiId: e.target.value })}
                        placeholder="Editable UPI ID"
                        className={inputDark}
                      />
                      <button
                        type="button"
                        onClick={() => notify("Updated UPI QR receiver ID.")}
                        className="px-3 py-2 rounded-xl bg-[#1E1E26] font-bold text-slate-200"
                      >
                        Save UPI
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {SAAS_PLANS.map((plan) => {
                    const active = currentPlan === plan.id;
                    return (
                      <div
                        key={plan.id}
                        className={`rounded-2xl border p-5 flex flex-col justify-between space-y-4 ${
                          active ? "border-red-600 bg-red-950/20" : subSurface
                        }`}
                      >
                        <div className="space-y-2">
                          <span className="px-2 py-0.5 rounded bg-red-950 text-red-300 text-[10px] font-bold">
                            {plan.badge}
                          </span>
                          <div className="text-lg font-extrabold">{plan.name}</div>
                          <div className="text-2xl font-extrabold text-red-400">
                            {plan.price === 0 ? "Free" : `${formatINR(plan.price)}/mo`}
                          </div>
                          <div className="text-slate-400">
                            Up to {plan.users} users · {plan.txns.toLocaleString("en-IN")} txns/mo
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={active}
                          onClick={() => {
                            if (plan.price === 0) {
                              setCurrentPlan(plan.id);
                              notify("Switched to Starter plan.");
                            } else {
                              setCheckoutPlan(plan);
                            }
                          }}
                          className={`w-full py-2.5 rounded-xl font-bold ${
                            active
                              ? "bg-[#22222A] text-slate-400 cursor-default"
                              : "bg-red-600 hover:bg-red-700 text-white"
                          }`}
                        >
                          {active ? "Active Plan" : "Upgrade via Razorpay / QR"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Razorpay & Editable PhonePe / GPay QR Checkout Modal */}
              {checkoutPlan && (
                <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
                  <div className={`w-full max-w-md rounded-3xl border p-6 space-y-4 shadow-2xl ${surface}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-extrabold">
                        Checkout: {checkoutPlan.name} ({formatINR(checkoutPlan.price)})
                      </h3>
                      <button type="button" onClick={() => setCheckoutPlan(null)}>
                        <X className="w-5 h-5 text-slate-400" />
                      </button>
                    </div>

                    <div className={`p-4 rounded-2xl border text-center space-y-2 ${subSurface}`}>
                      <QrCode className="w-24 h-24 mx-auto text-red-500" />
                      <div className="font-bold">Scan via PhonePe / GPay / Paytm</div>
                      <div className="font-mono text-red-400">UPI ID: {org.upiId}</div>
                    </div>

                    <input
                      value={utrInput}
                      onChange={(e) => setUtrInput(e.target.value)}
                      placeholder="Enter 12-digit UPI UTR or Razorpay Payment ID"
                      className={`w-full ${inputDark}`}
                    />

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentPlan(checkoutPlan.id);
                          setCheckoutPlan(null);
                          setUtrInput("");
                          notify(`Razorpay checkout completed! Upgraded to ${checkoutPlan.name}.`);
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold flex items-center justify-center gap-1.5"
                      >
                        <CreditCard className="w-4 h-4" /> Pay via Razorpay
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!utrInput.trim()) return notify("Enter UTR reference first.", "error");
                          setCurrentPlan(checkoutPlan.id);
                          setCheckoutPlan(null);
                          setUtrInput("");
                          notify(`Verified UTR ${utrInput}. Upgraded to ${checkoutPlan.name}.`);
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                      >
                        Verify UPI UTR
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}