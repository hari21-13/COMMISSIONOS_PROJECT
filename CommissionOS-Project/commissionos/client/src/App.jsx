import React, {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
} from "react";
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
  Filter,
  Download,
  Upload,
  Eye,
  Edit3,
  Trash2,
  Lock,
  Unlock,
  Check,
  X,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Sparkles,
  Sliders,
  Building,
  Award,
  Briefcase,
  UserCheck,
  UserX,
  Layers,
  Percent,
  DollarSign,
  Target,
  Package,
  Share2,
  GitBranch,
  Clock,
  AlertCircle,
  Printer,
  FileCheck,
  MessageSquare,
  Paperclip,
  Send,
  HelpCircle,
  Menu,
  ChevronDown,
  Info,
  CreditCard,
  KeyRound,
  LogOut,
  LogIn,
  UserPlus,
  Mail,
  Shield,
  Zap,
  Crown,
  Receipt,
  Calendar,
  CheckSquare,
  Phone,
  MessageCircle,
  MapPin,
  QrCode,
  Smartphone,
  Copy,
  History,
  User,
  EyeOff,
  Sun,
  Moon,
} from "lucide-react";

// ---- dark / bright theme (remembered per browser) ----
const THEME_KEY = "auron-commissionos:theme";
const readTheme = () => {
  try {
    return window.localStorage.getItem(THEME_KEY) === "light"
      ? "light"
      : "dark";
  } catch (err) {
    return "dark";
  }
};
const applyTheme = (t) => {
  try {
    document.documentElement.setAttribute("data-theme", t);
  } catch (err) {
    /* ignore */
  }
};
applyTheme(readTheme());

function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch (err) {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      data-allow="all"
      onClick={flip}
      className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
      title={theme === "dark" ? "Switch to bright mode" : "Switch to dark mode"}
      aria-label="Toggle dark / bright mode"
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4 text-amber-400" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
    </button>
  );
}
import { api, tokenStore } from "./api";
import seedData from "./seed-data.json";
import PlanCheckout, { FreeSubscriptionBanner } from "./PlanCheckout.jsx";
import { startViewOnlyGuard } from "./viewOnly";
import {
  downloadPdf,
  subscriptionInvoiceOps,
  subscriptionReceiptOps,
  adjustmentInvoiceOps,
  disputeInvoiceOps,
} from "./pdfInvoice";

// ============================================================================
// UTILITY FUNCTIONS & INDIAN CURRENCY FORMATTER
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

// DD-MM-YYYY  <->  YYYY-MM-DD (for native date pickers)
const dmyToIso = (d) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};
const isoToDmy = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

const roleLabelOf = (role) =>
  role === "admin"
    ? "Admin / Owner"
    : role === "employee"
      ? "Employee (Limited access)"
      : "User (View only)";
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (err) {
    return iso;
  }
};

// Click a table row -> only that row is highlighted, all others stay normal
const highlightClickedRow = (e) => {
  const tr = e.target.closest && e.target.closest("tbody tr");
  if (!tr || tr.querySelectorAll("td").length < 2) return;
  const tbody = tr.parentElement;
  tbody
    .querySelectorAll("tr[data-row-active]")
    .forEach((r) => r.removeAttribute("data-row-active"));
  tr.setAttribute("data-row-active", "true");
};

// ============================================================================
// DATA LAYER — all business data lives in PostgreSQL behind the Express API.
// The hooks below keep the exact same `[value, setValue]` shape the screens already use:
// when a screen changes a list, the change is diffed and sent to the API in order.
// ============================================================================
const UI_PREFIX = "auron-commissionos:ui:";

// Who is signed in: 'admin' (can edit everything), 'employee' (limited edit) or 'user' (view only).
// The server enforces this too — this just stops the screen from even trying a refused change.
let ACCESS = "admin";
const writeAllowed = (name) =>
  ACCESS === "admin" ||
  (ACCESS === "employee" && (name === "disputes" || name === "statements" || name === "transactions")) ||
  (ACCESS === "user" && (name === "disputes" || name === "transactions"));
const blockedWrite = () => {
  window.dispatchEvent(new CustomEvent("view-only-blocked"));
};

// small UI preferences only (current module, owner/salesperson view) — NOT business data
function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(UI_PREFIX + key);
      if (raw !== null) return JSON.parse(raw);
    } catch (err) {
      /* ignore */
    }
    return initial;
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(UI_PREFIX + key, JSON.stringify(value));
    } catch (err) {
      /* ignore */
    }
  }, [key, value]);
  return [value, setValue];
}

let syncChain = Promise.resolve();
function enqueueSync(fn) {
  syncChain = syncChain.then(fn).catch((err) => {
    window.dispatchEvent(new CustomEvent("sync-error", { detail: err }));
  });
  return syncChain;
}

// compares two lists by id and returns the API calls needed to make the server match `next`
function diffCollection(name, idKey, order, prev, next) {
  const prevMap = new Map(prev.map((x) => [x[idKey], x]));
  const nextMap = new Map(next.map((x) => [x[idKey], x]));
  const ops = [];
  prev.forEach((x) => {
    if (!nextMap.has(x[idKey]))
      ops.push({
        method: "DELETE",
        path: `/${name}/${encodeURIComponent(x[idKey])}`,
      });
  });
  const created = next.filter((x) => !prevMap.has(x[idKey]));
  // lists that show newest first: send the first item last so it ends up newest
  (order === "desc" ? [...created].reverse() : created).forEach((x) =>
    ops.push({ method: "POST", path: `/${name}`, body: x }),
  );
  next.forEach((x) => {
    const old = prevMap.get(x[idKey]);
    if (old && old !== x && JSON.stringify(old) !== JSON.stringify(x)) {
      ops.push({
        method: "PUT",
        path: `/${name}/${encodeURIComponent(x[idKey])}`,
        body: x,
      });
    }
  });
  return ops;
}

function useSyncedCollection(name, idKey = "id", order = "asc", initial = []) {
  const [items, setItems] = useState(initial);
  const ref = useRef(items);
  const set = useCallback(
    (updater) => {
      const prev = ref.current;
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (next === prev) return;
      if (!writeAllowed(name)) {
        blockedWrite();
        return;
      }
      ref.current = next;
      setItems(next);
      diffCollection(name, idKey, order, prev, next).forEach((op) =>
        enqueueSync(() => api.request(op.method, op.path, op.body)),
      );
    },
    [name, idKey, order],
  );
  // hydrate = replace local state with server data WITHOUT sending anything back
  const hydrate = useCallback((valueOrFn) => {
    const next =
      typeof valueOrFn === "function" ? valueOrFn(ref.current) : valueOrFn;
    ref.current = next;
    setItems(next);
  }, []);
  return [items, set, hydrate];
}

function useSyncedObject(name, initial = {}) {
  const [value, setValue] = useState(initial);
  const ref = useRef(value);
  const set = useCallback(
    (updater) => {
      const prev = ref.current;
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (next === prev) return;
      if (!writeAllowed(name)) {
        blockedWrite();
        return;
      }
      ref.current = next;
      setValue(next);
      enqueueSync(() => api.put(`/settings/${name}`, next));
    },
    [name],
  );
  const hydrate = useCallback((next) => {
    ref.current = next;
    setValue(next);
  }, []);
  return [value, set, hydrate];
}

const downloadCSV = (filename, headers, rows) => {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csvContent =
    "data:text/csv;charset=utf-8," +
    [
      headers.map(escape).join(","),
      ...rows.map((r) => r.map(escape).join(",")),
    ].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// ============================================================================
// SECTION 14: SAAS SUBSCRIPTION PLANS SPECIFICATION DATA
// ============================================================================
const SAAS_PLANS = [
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    intendedCustomer: "Small teams",
    badge: "Essential",
    description:
      "Core commission tracking and automated statements for early-stage sales teams.",
    limits: {
      users: 5,
      transactions: 500,
      policies: 3,
      storageGB: 5,
    },
    features: [
      "Up to 5 active users & reps",
      "Up to 500 sales transactions / month",
      "Fixed % & Per-Sale commission models",
      "Monthly commission statements & PDF export",
      "Standard email support",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPrice: 2499,
    annualMonthlyPrice: 1999,
    intendedCustomer: "Growing teams",
    badge: "Most Popular",
    popular: true,
    description:
      "Full 7-model commission engine, bulk CSV/Excel imports, and reversal tracking.",
    limits: {
      users: 25,
      transactions: 5000,
      policies: 15,
      storageGB: 25,
    },
    features: [
      "Up to 25 active users & partners",
      "Up to 5,000 sales transactions / month",
      "All 7 commission models (Marginal & Attainment Tiers)",
      "7-step CSV & Excel bulk import wizard",
      "Returns, refunds & clawback automation",
    ],
  },
  {
    id: "business",
    name: "Business",
    monthlyPrice: 5999,
    annualMonthlyPrice: 4799,
    intendedCustomer: "Established businesses",
    badge: "Full Suite",
    description:
      "Multi-level governance approvals, bank reconciliation, disputes, and 13-report suite.",
    limits: {
      users: 100,
      transactions: 999999,
      policies: 999,
      storageGB: 100,
    },
    features: [
      "Up to 100 active users & channel partners",
      "Unlimited monthly sales transactions",
      "7-stage approval workflow & statement locking",
      "Bank payout reconciliation & dispute portal",
      "All 13 executive & compliance reports",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyPrice: null,
    annualMonthlyPrice: null,
    intendedCustomer: "Large organisations",
    badge: "Custom",
    description:
      "Tailored deployment with ERP/CRM APIs, custom RBAC, SSO, and dedicated SLA.",
    limits: {
      users: 9999,
      transactions: 9999999,
      policies: 9999,
      storageGB: 1000,
    },
    features: [
      "Unlimited users, teams & multi-entity branches",
      "Unlimited transactions & custom data retention",
      "Bi-directional ERP / CRM / HRMS webhooks",
      "SAML SSO, custom RBAC & audit log streaming",
      "Dedicated Customer Success & 99.9% SLA",
    ],
  },
];

function computePolicyCommission(
  policy,
  salesAmount,
  saleCount = 1,
  product = "Product A",
) {
  const sales = Number(salesAmount) || 0;
  if (!policy) return { commission: 0, breakdown: "No policy assigned" };

  switch (policy.model) {
    case "A": {
      const rate = Number(policy.rate) || 0;
      const comm = (sales * rate) / 100;
      return {
        commission: comm,
        breakdown: `${formatINR(sales)} × ${rate}% = ${formatINR(comm)}`,
      };
    }
    case "B": {
      const perSale = Number(policy.fixedAmount) || 0;
      const comm = saleCount * perSale;
      return {
        commission: comm,
        breakdown: `${saleCount} sale(s) × ${formatINR(perSale)} = ${formatINR(comm)}`,
      };
    }
    case "C": {
      const slabs = policy.slabs?.length
        ? policy.slabs
        : [
          { min: 0, max: 100000, rate: 2 },
          { min: 100001, max: 300000, rate: 4 },
          { min: 300001, max: 99999999, rate: 6 },
        ];
      if (policy.tierMethod === "attainment") {
        const matched =
          slabs.find((s) => sales >= s.min && sales <= s.max) ||
          slabs[slabs.length - 1];
        const comm = (sales * matched.rate) / 100;
        return {
          commission: comm,
          breakdown: `Attainment Tier (${matched.rate}% on full ${formatINR(sales)}) = ${formatINR(comm)}`,
        };
      } else {
        let remaining = sales;
        let total = 0;
        const parts = [];
        let prevMax = 0;
        for (const s of slabs) {
          if (remaining <= 0) break;
          const span =
            s.max >= 99999999
              ? remaining
              : Math.min(remaining, s.max - prevMax);
          const sliceComm = (span * s.rate) / 100;
          total += sliceComm;
          parts.push(`${formatINR(span)}×${s.rate}%=${formatINR(sliceComm)}`);
          remaining -= span;
          prevMax = s.max;
        }
        return {
          commission: total,
          breakdown: `Marginal: ${parts.join(" + ")} = ${formatINR(total)}`,
        };
      }
    }
    case "D": {
      const target = Number(policy.targetAmount) || 500000;
      const bonus = Number(policy.targetBonus) || 10000;
      const pct = target > 0 ? Math.round((sales / target) * 100) : 0;
      const achieved = sales >= target;
      return {
        commission: achieved ? bonus : 0,
        breakdown: `Target ${formatINR(target)} | Actual ${formatINR(sales)} (${pct}%) → ${achieved ? `Bonus ${formatINR(bonus)}` : "Target not met (₹0)"
          }`,
      };
    }
    case "E": {
      const map = policy.productRates?.length
        ? policy.productRates
        : [
          { product: "Product A", rate: 3 },
          { product: "Product B", rate: 5 },
          { product: "Product C", rate: 8 },
        ];
      const found = map.find((p) => p.product === product) || map[0];
      const rate = found ? Number(found.rate) : 3;
      const comm = (sales * rate) / 100;
      return {
        commission: comm,
        breakdown: `${product} (${rate}%) on ${formatINR(sales)} = ${formatINR(comm)}`,
      };
    }
    case "F": {
      const rate = Number(policy.referralRate || policy.rate) || 5;
      const comm = (sales * rate) / 100;
      return {
        commission: comm,
        breakdown: `Referral ${formatINR(sales)} × ${rate}% = ${formatINR(comm)}`,
      };
    }
    case "G": {
      const poolRate = Number(policy.rate) || 10;
      const pool = (sales * poolRate) / 100;
      const splits = policy.multiLevelSplits?.length
        ? policy.multiLevelSplits
        : [
          { role: "Sales Representative", share: 70 },
          { role: "Sales Manager", share: 20 },
          { role: "Referral Partner", share: 10 },
        ];
      const splitSummary = splits
        .map(
          (sp) =>
            `${sp.role} ${sp.share}% (${formatINR((pool * sp.share) / 100)})`,
        )
        .join(", ");
      return {
        commission: pool,
        breakdown: `Pool ${formatINR(pool)} → ${splitSummary}`,
      };
    }
    default:
      return { commission: 0, breakdown: "Custom rule" };
  }
}

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================

// ============================================================================
// INVITATION ACCEPTANCE PAGE (opened from the link in the invitation e-mail)
// ============================================================================
function InviteAcceptPage({ invite, onAccept }) {
  const [name, setName] = useState(invite.n || "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [declined, setDeclined] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter your full name.");
    if (password.length < 6)
      return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setError("");
    const res = await onAccept(name.trim(), password);
    if (res && !res.ok) setError(res.error);
    return undefined;
  };

  if (declined) {
    return (
      <div className="min-h-screen bg-[#F5F5F6] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-10 max-w-md text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-full bg-slate-100 flex items-center justify-center">
            <X className="w-7 h-7 text-slate-500" />
          </div>
          <h2 className="text-lg font-extrabold text-slate-900">
            Invitation declined
          </h2>
          <p className="text-xs text-slate-500">
            You declined the invitation to join {invite.o}. You can close this
            page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#400C0C] to-[#DC2626] flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-5 text-xs"
      >
        <div className="text-center space-y-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-600 text-white flex items-center justify-center">
            <UserPlus className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-extrabold text-slate-900">
            You&rsquo;re invited!
          </h2>
          <p className="text-slate-600">
            <strong>{invite.o}</strong> invited you to join Auron CommissionOS
            as
          </p>
          <span className="inline-block px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold">
            {invite.r}
          </span>
        </div>
        <div>
          <label className="font-semibold block mb-1">Email</label>
          <input
            value={invite.e}
            readOnly
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-600"
          />
        </div>
        <div>
          <label className="font-semibold block mb-1">Full Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="font-semibold block mb-1">Create Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5"
            />
          </div>
        </div>
        {error && <div className="text-rose-600 font-semibold">{error}</div>}
        <button
          type="submit"
          className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center justify-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4" /> Accept Invitation & Join
        </button>
        <button
          type="button"
          onClick={() => setDeclined(true)}
          className="w-full py-2 text-slate-500 hover:text-slate-800 font-semibold"
        >
          Decline
        </button>
      </form>
    </div>
  );
}

// ============================================================================
// FOOTER
// ============================================================================
function AppFooter({ org }) {
  const year = new Date().getFullYear();
  const name = org?.name || "Auron Technologies";
  const contact = getContact(org);
  return (
    <footer className="mt-auto border-t border-slate-200 bg-gradient-to-b from-white to-slate-50">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-7 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center font-extrabold text-[11px]">
              AC
            </div>
            <div className="text-sm font-extrabold text-slate-900">
              Auron CommissionOS
            </div>
          </div>
          <p className="text-slate-500 leading-relaxed max-w-xs">
            Commission calculation, approvals, payouts and analytics — one
            workspace for sales incentive operations.
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Support
          </div>
          <a
            href={`mailto:${contact.email}`}
            className="flex items-center gap-2 text-slate-700 hover:text-blue-700 transition"
          >
            <Mail className="w-3.5 h-3.5 text-blue-600" /> {contact.email}
          </a>
          <a
            href={`tel:+91${contact.phone}`}
            className="flex items-center gap-2 text-slate-700 hover:text-blue-700 transition"
          >
            <Phone className="w-3.5 h-3.5 text-sky-600" />{" "}
            {contact.phoneDisplay}
          </a>
          <a
            href={`https://wa.me/91${contact.phone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-slate-700 hover:text-emerald-700 transition"
          >
            <MessageCircle className="w-3.5 h-3.5 text-emerald-600" /> WhatsApp
          </a>
        </div>
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Office Hours
          </div>
          <div className="flex items-center gap-2 text-slate-700">
            <Clock className="w-3.5 h-3.5 text-amber-600" /> {contact.hours}
          </div>
          <div className="text-slate-500 pl-5">{contact.days}</div>
          <div className="flex items-start gap-2 text-slate-500">
            <MapPin className="w-3.5 h-3.5 text-rose-500 mt-0.5 shrink-0" />{" "}
            <span>{org?.address || "Bangalore, India"}</span>
          </div>
        </div>
      </div>
      <div className="border-t border-slate-200 py-3 px-4 text-center text-[11px] text-slate-500">
        © {year} {name} · All rights reserved · Auron CommissionOS v1.0 · Made
        with care by Alpha Auron
      </div>
    </footer>
  );
}

// ============================================================================
// LOGIN PAGE (Email + Password + Name, Google sign-in, #admin / #employee portals)
// ============================================================================
function SplashScreen({ text, action, secondary }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#050505] via-[#4A0E0E] to-[#DC2626] flex items-center justify-center p-6 text-white">
      <div className="text-center space-y-4 anim-pop max-w-sm">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center font-extrabold glow-pulse">
          AC
        </div>
        <div className="text-sm font-semibold">{text}</div>
        {!action && !String(text).startsWith("Could not") && (
          <RefreshCw className="w-5 h-5 mx-auto animate-spin text-blue-200" />
        )}
        <div className="flex justify-center gap-2">
          {action && (
            <button
              onClick={action.onClick}
              className="px-4 py-2 rounded-xl bg-white text-slate-900 text-xs font-bold"
            >
              {action.label}
            </button>
          )}
          {secondary && (
            <button
              onClick={secondary.onClick}
              className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-xs font-bold"
            >
              {secondary.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.8 6.6-9.5 6.6-16.9z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.3-8.8 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

function GoogleSignInButton({ config, onResult }) {
  const ref = useRef(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demo, setDemo] = useState({ name: "", email: "" });
  const [demoErr, setDemoErr] = useState("");
  const clientId = config.googleClientId;

  useEffect(() => {
    if (!clientId || typeof document === "undefined") return undefined;
    const init = () => {
      if (!window.google?.accounts?.id || !ref.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) =>
          onResult(
            resp && resp.credential ? { idToken: resp.credential } : null,
          ),
      });
      window.google.accounts.id.renderButton(ref.current, {
        theme: "outline",
        size: "large",
        width: 340,
        text: "continue_with",
        shape: "pill",
      });
    };
    if (window.google?.accounts?.id) {
      init();
      return undefined;
    }
    const sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true;
    sc.onload = init;
    document.head.appendChild(sc);
    return undefined;
  }, [clientId]);

  // real Google sign-in (server verifies the ID token)
  if (clientId)
    return <div ref={ref} className="flex justify-center min-h-[44px]" />;

  // not configured on the server
  if (!config.demoGoogle) {
    return (
      <button
        type="button"
        disabled
        title="Set GOOGLE_CLIENT_ID on the server to enable Google sign-in"
        className="w-full py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-400 flex items-center justify-center gap-3 cursor-not-allowed"
      >
        <GoogleLogo /> Continue with Google (not configured)
      </button>
    );
  }

  // development demo chooser (server must run with ALLOW_DEMO_GOOGLE=true)
  const submitDemo = (e) => {
    e.preventDefault();
    if (!demo.name.trim()) return setDemoErr("Enter your Google account name.");
    if (!/^\S+@\S+\.\S+$/.test(demo.email))
      return setDemoErr("Enter a valid Google email.");
    setDemoErr("");
    setDemoOpen(false);
    onResult({ profile: { name: demo.name.trim(), email: demo.email.trim() } });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setDemoOpen(true)}
        className="w-full py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 hover:shadow-md text-sm font-semibold text-slate-800 flex items-center justify-center gap-3 transition"
      >
        <GoogleLogo /> Continue with Google
      </button>
      {demoOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={submitDemo}
            className="modal-pop bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 text-xs shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <GoogleLogo />
              <div>
                <div className="text-sm font-bold text-slate-900">
                  Sign in with Google
                </div>
                <div className="text-[11px] text-amber-700 font-semibold">
                  Demo mode — set GOOGLE_CLIENT_ID on the server for real Google
                  accounts
                </div>
              </div>
            </div>
            <input
              value={demo.name}
              onChange={(e) => setDemo({ ...demo, name: e.target.value })}
              placeholder="Google account name"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5"
            />
            <input
              type="email"
              value={demo.email}
              onChange={(e) => setDemo({ ...demo, email: e.target.value })}
              placeholder="you@gmail.com"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5"
            />
            {demoErr && (
              <div className="text-rose-600 font-semibold">{demoErr}</div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDemoOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
              >
                Continue
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function LoginPage({ mode, authConfig, onSignIn, onRegister, onGoogle }) {
  const [tab, setTab] = useState("signin");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = mode === "admin";
  const meta = {
    admin: {
      title: "Admin Portal",
      sub: "Full access — manage users, data, settings and approvals.",
      badge: "bg-rose-100 text-rose-700",
      icon: ShieldCheck,
    },
    employee: {
      title: "Employee Portal",
      sub: "Sign in with your work e-mail and password. See everything, edit only what you are allowed to.",
      badge: "bg-emerald-100 text-emerald-700",
      icon: UserCheck,
    },
    user: {
      title: "Partner Portal",
      sub: "Sign in to see your own sales, commissions, statements and payouts.",
      badge: "bg-blue-100 text-blue-700",
      icon: Users,
    },
  }[mode];
  const Icon = meta.icon;

  const submit = async (e) => {
    e.preventDefault();

    console.log("hey i am submit");
    if (!form.name.trim()) return setError("Please enter your name.");
    if (!/^\S+@\S+\.\S+$/.test(form.email))
      return setError("Please enter a valid email address.");
    if (form.password.length < 6)
      return setError("Password must be at least 6 characters.");
    setError("");
    setBusy(true);
    const res = await (tab === "signin" || isAdmin
      ? onSignIn(form)
      : onRegister(form));
    setBusy(false);
    if (!res.ok) setError(res.error);
    return undefined;
  };

  const handleGoogle = async (payload) => {
    if (!payload) return setError("Google sign-in failed. Try again.");
    setError("");
    const res = await onGoogle(payload);
    if (!res.ok) setError(res.error);
    return undefined;
  };

  const field =
    "w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3.5 py-3 text-sm focus:border-blue-600 focus:ring-4 focus:ring-blue-100 focus:outline-none";

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F5F6] font-sans antialiased">
      <div className="flex-1 grid lg:grid-cols-2">
        {/* Brand panel */}
        <div className="relative overflow-hidden hidden lg:flex flex-col justify-between p-12 text-white bg-gradient-to-br from-[#050505] via-[#4A0E0E] to-[#DC2626] bg-animate">
          <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-blue-400/20 blur-3xl float-slow" />
          <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] rounded-full bg-indigo-400/20 blur-3xl float-slower" />
          <div className="absolute top-1/3 right-16 w-24 h-24 rounded-3xl border border-white/20 bg-white/5 rotate-12 float-slow" />
          <div className="absolute bottom-1/4 left-16 w-16 h-16 rounded-2xl border border-white/20 bg-white/5 -rotate-12 float-slower" />
          <div className="relative flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center font-extrabold">
              AC
            </div>
            <div className="text-lg font-extrabold tracking-tight">
              Auron CommissionOS
            </div>
          </div>
          <div className="relative space-y-6 max-w-md anim-pop">
            <h1 className="text-4xl font-extrabold leading-tight">
              Every commission, calculated and paid with confidence.
            </h1>
            <ul className="space-y-3 text-sm text-blue-100">
              {[
                "7 commission models with transparent formulas",
                "Approvals, payouts and reconciliation in one flow",
                "Admin edits everything · employees get limited edit · users view only",
              ].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" />{" "}
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative text-xs text-blue-200">
            Sales incentive operations platform
          </div>
        </div>

        {/* Form panel */}
        <div className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md anim-pop">
            <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-8 space-y-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center glow-pulse">
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${meta.badge}`}
                  >
                    {mode === "admin"
                      ? "Admin"
                      : mode === "employee"
                        ? "Employee"
                        : "Partner"}{" "}
                    login
                  </span>
                  <h2 className="text-xl font-extrabold text-slate-900 mt-1">
                    {meta.title}
                  </h2>
                </div>
              </div>
              <p className="text-xs text-slate-500 -mt-2">{meta.sub}</p>

              {!isAdmin && (
                <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-xl text-xs">
                  {[
                    ["signin", "Sign In"],
                    ["register", "Create Account"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setTab(id);
                        setError("");
                      }}
                      className={`py-2 rounded-lg font-bold ${tab === id ? "bg-white shadow-xs text-slate-900" : "text-slate-500"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={submit} className="space-y-4">
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Full name"
                    className={field}
                    autoComplete="name"
                  />
                </div>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    placeholder="Email address"
                    className={field}
                    autoComplete="email"
                  />
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPw ? "text" : "password"}
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                    placeholder="Password"
                    className={`${field} pr-11`}
                    autoComplete={
                      tab === "signin" ? "current-password" : "new-password"
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                  >
                    {showPw ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {error && (
                  <div className="anim-pop rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold px-3.5 py-2.5">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-70 text-white text-sm font-bold shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2"
                >
                  {busy ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4" />
                  )}
                  {tab === "signin" || isAdmin ? "Sign In" : "Create Account"}
                </button>
              </form>

              {isAdmin && (
                <>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 font-semibold">
                    <span className="h-px flex-1 bg-slate-200" /> OR{" "}
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>
                  <GoogleSignInButton config={authConfig} onResult={handleGoogle} />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}

// ============================================================================
// POLICY INSIGHTS: live calculator + "how each plan works" (shown to everybody, incl. employees)
// ============================================================================
const PLAN_GUIDE = {
  A: {
    icon: "%",
    title: "Fixed percentage",
    steps: [
      "Take the eligible sales (invoice − discount)",
      "Multiply by the plan %",
      "That amount is your commission",
    ],
  },
  B: {
    icon: "₹",
    title: "Flat amount per sale",
    steps: [
      "Count your validated sales",
      "Every sale earns the same fixed amount",
      "Commission = number of sales × amount",
    ],
  },
  C: {
    icon: "≡",
    title: "Slab / tier",
    steps: [
      "Add up your eligible sales for the period",
      "Find the slab(s) your total falls in",
      "Marginal: each slab pays its own %. Attainment: the matched % applies to everything",
    ],
  },
  D: {
    icon: "◎",
    title: "Target bonus",
    steps: [
      "Add up your eligible sales",
      "Earn the base % on them",
      "Reach the target and a bonus is added on top",
    ],
  },
  E: {
    icon: "▦",
    title: "Product mix",
    steps: [
      "Every product has its own %",
      "Each sale is paid at its product rate",
      "Commission = sum of all sale commissions",
    ],
  },
  F: {
    icon: "⇄",
    title: "Partner referral",
    steps: [
      "A referred sale is validated",
      "The referral % applies to its eligible amount",
      "The partner is paid the referral commission",
    ],
  },
  G: {
    icon: "⛓",
    title: "Multi-level split",
    steps: [
      "The sale creates one commission pool",
      "The pool is split across the levels",
      "Each level receives its share %",
    ],
  },
};

const ruleTextOf = (p) => {
  if (p.model === "A") return `${p.rate}% of eligible sales`;
  if (p.model === "B")
    return `${formatINR(p.fixedAmount)} for every validated sale`;
  if (p.model === "C" && p.slabs && p.slabs.length)
    return `${p.tierMethod === "attainment" ? "Attainment tier" : "Marginal slabs"}: ${p.slabs.map((s) => `${formatINR(s.min)}–${s.max >= 99999999 ? "∞" : formatINR(s.max)} @ ${s.rate}%`).join(" · ")}`;
  if (p.model === "D")
    return `${p.rate}% base, plus ${formatINR(p.targetBonus)} bonus on reaching ${formatINR(p.targetAmount)}`;
  if (p.model === "E" && p.productRates && p.productRates.length)
    return p.productRates.map((r) => `${r.product}: ${r.rate}%`).join(" · ");
  if (p.model === "F") return `${p.referralRate}% referral commission`;
  if (p.model === "G" && p.multiLevelSplits && p.multiLevelSplits.length)
    return p.multiLevelSplits
      .map((s) => `${s.level || s.name}: ${s.percent ?? s.rate}%`)
      .join(" · ");
  return p.description || "";
};

function PolicyInsights({ policies }) {
  const [planId, setPlanId] = useState(policies[0] ? policies[0].id : "");
  const [amount, setAmount] = useState(100000);
  const [count, setCount] = useState(1);
  const [product, setProduct] = useState("Product A");
  const plan = policies.find((p) => p.id === planId) || policies[0];
  if (!plan) return null;
  let live = { commission: 0, breakdown: "" };
  try {
    live = computePolicyCommission(
      plan,
      amount,
      Math.max(1, Number(count) || 1),
      product,
    );
  } catch (err) {
    /* keep zero */
  }
  const eff = Number(amount) > 0 ? (live.commission / Number(amount)) * 100 : 0;
  const products =
    (plan.productRates && plan.productRates.map((r) => r.product)) || [];
  const field =
    "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold";
  return (
    <div className="space-y-6">
      {/* LIVE CALCULATION */}
      <div className="relative overflow-hidden rounded-3xl border border-red-900/40 bg-gradient-to-br from-[#0A0A0B] via-[#2A0A0A] to-[#7F1D1D] p-6 text-white shadow-lg">
        <div className="absolute -right-10 -top-10 w-56 h-56 rounded-full bg-red-600/30 blur-3xl" />
        <div className="relative grid grid-cols-1 lg:grid-cols-5 gap-6 items-center">
          <div className="lg:col-span-3 space-y-4" data-allow="all">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-red-300">
                Live calculation
              </div>
              <h3 className="text-xl font-extrabold">
                Try any plan — the result updates as you type
              </h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <label className="col-span-2 md:col-span-1">
                <span className="block font-semibold text-red-100 mb-1">
                  Plan
                </span>
                <select
                  value={plan.id}
                  onChange={(e) => setPlanId(e.target.value)}
                  className={`${field} !bg-white/10 !text-white !border-white/20`}
                >
                  {policies.map((p) => (
                    <option key={p.id} value={p.id} className="text-black">
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="block font-semibold text-red-100 mb-1">
                  Sale amount (₹)
                </span>
                <input
                  type="number"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={`${field} !bg-white/10 !text-white !border-white/20`}
                />
              </label>
              <label>
                <span className="block font-semibold text-red-100 mb-1">
                  No. of sales
                </span>
                <input
                  type="number"
                  min="1"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  className={`${field} !bg-white/10 !text-white !border-white/20`}
                />
              </label>
              <label>
                <span className="block font-semibold text-red-100 mb-1">
                  Product
                </span>
                <select
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  className={`${field} !bg-white/10 !text-white !border-white/20`}
                >
                  {(products.length
                    ? products
                    : ["Product A", "Product B", "Product C"]
                  ).map((x) => (
                    <option key={x} value={x} className="text-black">
                      {x}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="rounded-xl bg-black/40 border border-white/10 p-3 font-mono text-[11px] text-red-100 break-words">
              {live.breakdown || "Enter a sale amount"}
            </div>
          </div>
          <div className="lg:col-span-2 text-center rounded-2xl bg-white/10 border border-white/15 p-6">
            <div className="text-[11px] font-bold uppercase text-red-200">
              Commission
            </div>
            <div className="text-4xl font-black mt-1 text-white tabular-nums">
              {formatINR(live.commission)}
            </div>
            <div className="text-xs text-red-200 mt-1">
              ≈ {eff.toFixed(2)}% effective rate
            </div>
            <div className="mt-4 h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-red-700 to-red-400 transition-all duration-500"
                style={{ width: `${Math.min(100, eff * 8)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* HOW EACH PLAN PLAYS */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900">
            How each plan works
          </h3>
          <p className="text-xs text-slate-500">
            Plain steps for every commission plan, with the same sale run
            through each of them.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {policies.map((p) => {
            const g = PLAN_GUIDE[p.model] || PLAN_GUIDE.A;
            return (
              <div
                key={p.id}
                className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 overflow-hidden flex flex-col"
              >
                <div className="p-4 bg-gradient-to-r from-[#0A0A0B] to-[#7F1D1D] text-white flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center text-lg font-black">
                    {g.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{p.name}</div>
                    <div className="text-[11px] text-red-200">
                      {g.title} · {p.version}
                    </div>
                  </div>
                </div>
                <div className="p-4 space-y-3 text-xs flex-1">
                  <ol className="space-y-1.5">
                    {g.steps.map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {i + 1}
                        </span>
                        <span className="text-slate-700">{s}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="rounded-lg bg-slate-100 border border-slate-200 p-2.5 text-slate-700">
                    <b className="text-slate-900">This plan: </b>
                    {ruleTextOf(p)}
                  </div>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-slate-500 uppercase">
                        <th className="text-left py-1">Sale</th>
                        <th className="text-right py-1">Commission</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[50000, 100000, 500000].map((s) => {
                        let r = { commission: 0 };
                        try {
                          r = computePolicyCommission(p, s, 1, "Product A");
                        } catch (err) {
                          /* ignore */
                        }
                        return (
                          <tr key={s}>
                            <td className="py-1.5 text-slate-600">
                              {formatINR(s)}
                            </td>
                            <td className="py-1.5 text-right font-bold text-red-600">
                              {formatINR(r.commission)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {p.reversalRule && (
                    <div className="text-[11px] text-slate-500">
                      <b>Refund rule:</b> {p.reversalRule}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// STATEMENT CALCULATION DETAIL: every step behind one employee's statement
// ============================================================================
function StatementCalcDetail({ stmt, employees, policies, transactions }) {
  const lc = (v) =>
    String(v || "")
      .trim()
      .toLowerCase();
  const emp = employees.find(
    (e) => e.id === stmt.employeeId || lc(e.name) === lc(stmt.employee),
  );
  const policy =
    policies.find((p) => emp && p.id === emp.planId) ||
    policies.find(
      (p) => stmt.policyApplied && stmt.policyApplied.startsWith(p.name),
    ) ||
    null;
  const txns = transactions.filter(
    (t) =>
      (t.salespersonId === stmt.employeeId ||
        lc(t.salesperson) === lc(stmt.employee) ||
        lc(t.referrer) === lc(stmt.employee)) &&
      (t.status === "Validated" || t.status === "Eligible"),
  );
  if (!txns.length) return null;
  const perTxn = !policy || !(policy.model === "C" || policy.model === "D");
  const rows = txns.map((t) => {
    let r = { commission: 0, breakdown: "" };
    if (policy && perTxn) {
      try {
        r = computePolicyCommission(policy, t.eligibleBase, 1, t.product);
      } catch (err) {
        /* ignore */
      }
    }
    return { t, r };
  });
  const base = txns.reduce((s, t) => s + (Number(t.eligibleBase) || 0), 0);
  let total = 0;
  let rule = "";
  if (policy) {
    if (perTxn) {
      total = rows.reduce((s, x) => s + x.r.commission, 0);
      rule = `${policy.name}: ${ruleTextOf(policy)}`;
    } else {
      const r = computePolicyCommission(policy, base, txns.length);
      total = r.commission;
      rule = r.breakdown;
    }
  }
  const matches = policy
    ? Math.abs(Math.round(total) - Number(stmt.grossCommission || 0)) < 1
    : null;
  const th = "py-2.5 px-3 whitespace-nowrap";
  return (
    <div className="space-y-4">
      <h4 className="text-xs font-bold uppercase text-slate-500">
        Full calculation — step by step
      </h4>
      <div className="rounded-2xl border border-red-900/30 bg-gradient-to-br from-slate-50 to-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {[
          [
            "1",
            "Validated sales picked",
            `${txns.length} transaction(s): ${txns.map((t) => t.id).join(", ")}`,
          ],
          ["2", "Eligible base", `Σ (invoice − discount) = ${formatINR(base)}`],
          ["3", "Plan rule applied", rule || "No plan found for this employee"],
          [
            "4",
            "Gross commission",
            `${formatINR(Math.round(total))}${matches === null ? "" : matches ? " ✓ matches the statement" : ` ≠ statement ${formatINR(stmt.grossCommission)} (statement was edited / adjusted)`}`,
          ],
          [
            "5",
            "Reversals (refund clawback)",
            `− ${formatINR(stmt.reversals)}`,
          ],
          [
            "6",
            "Adjustments & deductions",
            `+ ${formatINR(stmt.adjustments)} − ${formatINR(stmt.deductions)}`,
          ],
        ].map(([n, t, d]) => (
          <div key={n} className="flex gap-3 items-start">
            <span className="w-6 h-6 rounded-full bg-red-600 text-white text-[11px] font-extrabold flex items-center justify-center shrink-0">
              {n}
            </span>
            <div>
              <div className="font-bold text-slate-900">{t}</div>
              <div className="text-slate-600 font-mono text-[11px] break-words">
                {d}
              </div>
            </div>
          </div>
        ))}
        <div className="md:col-span-2 rounded-xl bg-[#0A0A0B] text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-red-200">
            Net = {formatINR(stmt.grossCommission)} −{" "}
            {formatINR(stmt.reversals)} + {formatINR(stmt.adjustments)} −{" "}
            {formatINR(stmt.deductions)}
          </span>
          <span className="text-lg font-black text-red-400">
            {formatINR(stmt.netPayable)}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
            <tr>
              <th className={th}>Transaction</th>
              <th className={th}>Customer / Product</th>
              <th className={`${th} text-right`}>Invoice</th>
              <th className={`${th} text-right`}>Discount</th>
              <th className={`${th} text-right`}>Eligible Base</th>
              <th className={th}>Calculation</th>
              <th className={`${th} text-right`}>Commission</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ t, r }) => (
              <tr key={t.id}>
                <td className="py-2.5 px-3 font-bold text-red-600 whitespace-nowrap">
                  {t.id} ({t.invoiceNumber})
                </td>
                <td className="py-2.5 px-3">
                  {t.customer} · {t.product}
                </td>
                <td className="py-2.5 px-3 text-right">
                  {formatINR(t.invoiceAmount)}
                </td>
                <td className="py-2.5 px-3 text-right text-rose-600">
                  −{formatINR(t.discount)}
                </td>
                <td className="py-2.5 px-3 text-right font-semibold">
                  {formatINR(t.eligibleBase)}
                </td>
                <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                  {perTxn ? r.breakdown : "Slab / target applied on the total"}
                </td>
                <td className="py-2.5 px-3 text-right font-bold">
                  {perTxn ? formatINR(r.commission) : "—"}
                </td>
              </tr>
            ))}
            <tr className="bg-red-50/70 font-extrabold">
              <td className="py-3 px-3" colSpan={4}>
                Total
              </td>
              <td className="py-3 px-3 text-right">{formatINR(base)}</td>
              <td className="py-3 px-3" />
              <td className="py-3 px-3 text-right text-red-700">
                {formatINR(Math.round(total))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// REPORTS OVERVIEW: bar graph + pie chart that are always visible at the top of Reports
// ============================================================================
function ReportsOverview({ statements, employees }) {
  const byEmp = new Map();
  statements.forEach((s) =>
    byEmp.set(
      s.employee,
      (byEmp.get(s.employee) || 0) + (Number(s.netPayable) || 0),
    ),
  );
  if (byEmp.size === 0)
    employees.forEach((e) =>
      byEmp.set(e.name, Number(e.earnedCommission) || 0),
    );
  const barData = Array.from(byEmp, ([label, value]) => ({ label, value }))
    .filter((d) => d.value > 0)
    .slice(0, 8);
  const pieRaw = [
    [
      "Paid",
      employees.reduce((s, e) => s + (Number(e.paidCommission) || 0), 0),
    ],
    [
      "Approved",
      employees.reduce((s, e) => s + (Number(e.approvedCommission) || 0), 0),
    ],
    [
      "Pending",
      employees.reduce((s, e) => s + (Number(e.pendingCommission) || 0), 0),
    ],
  ];
  const pieData = pieRaw
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({ label, value }));
  if (!barData.length && !pieData.length) return null;
  const colors = [
    "#DC2626",
    "#F97316",
    "#FBBF24",
    "#A1A1AA",
    "#7F1D1D",
    "#F87171",
    "#52525B",
    "#FCA5A5",
  ];
  const W = 520,
    H = 250,
    padL = 54,
    padB = 40,
    padT = 18,
    padR = 12;
  const innerW = W - padL - padR,
    innerH = H - padT - padB;
  const max = Math.max(1, ...barData.map((d) => d.value));
  const slot = innerW / Math.max(1, barData.length);
  const barW = Math.min(48, slot * 0.6);
  const compact = (v) =>
    v >= 1e7
      ? `${(v / 1e7).toFixed(1)}Cr`
      : v >= 1e5
        ? `${(v / 1e5).toFixed(1)}L`
        : v >= 1e3
          ? `${(v / 1e3).toFixed(0)}K`
          : String(Math.round(v));
  const total = pieData.reduce((s, d) => s + d.value, 0);
  let ang = -Math.PI / 2;
  const slices = pieData.map((d, i) => {
    const frac = d.value / total;
    const a0 = ang;
    const a1 = ang + frac * Math.PI * 2;
    ang = a1;
    const pt = (a) => [100 + 80 * Math.cos(a), 100 + 80 * Math.sin(a)];
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(frac > 0.9999 ? a0 + Math.PI * 1.999 : a1);
    return {
      ...d,
      color: colors[i % colors.length],
      pct: frac * 100,
      path: `M100 100 L${x0} ${y0} A80 80 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1} Z`,
    };
  });
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-bold text-slate-900">
          Commission by employee — Bar graph
        </div>
        <div className="text-[11px] text-slate-500 mb-2">
          Net payable per person
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = padT + innerH - innerH * t;
            return (
              <g key={t}>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={y}
                  y2={y}
                  stroke="#3F3F46"
                  strokeDasharray="3 3"
                />
                <text
                  x={padL - 6}
                  y={y + 3}
                  fontSize="9"
                  textAnchor="end"
                  fill="#A1A1AA"
                >
                  {compact(max * t)}
                </text>
              </g>
            );
          })}
          {barData.map((d, i) => {
            const h = (d.value / max) * innerH;
            const x = padL + slot * i + (slot - barW) / 2;
            const y = padT + innerH - h;
            return (
              <g key={d.label}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx="6"
                  fill={colors[i % colors.length]}
                >
                  <title>{`${d.label}: ${formatINR(d.value)}`}</title>
                </rect>
                <text
                  x={x + barW / 2}
                  y={y - 5}
                  fontSize="9"
                  textAnchor="middle"
                  fill="#E4E4E7"
                  fontWeight="700"
                >
                  {compact(d.value)}
                </text>
                <text
                  x={x + barW / 2}
                  y={H - padB + 14}
                  fontSize="9"
                  textAnchor="middle"
                  fill="#A1A1AA"
                >
                  {d.label.length > 10 ? `${d.label.slice(0, 9)}…` : d.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-bold text-slate-900">
          Commission status — Pie chart
        </div>
        <div className="text-[11px] text-slate-500 mb-2">
          Paid vs approved vs pending · total {formatINR(total)}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-6">
          <svg viewBox="0 0 200 200" className="w-48 h-48 shrink-0">
            {slices.map((s) => (
              <path
                key={s.label}
                d={s.path}
                fill={s.color}
                stroke="#18181B"
                strokeWidth="2"
              >
                <title>{`${s.label}: ${formatINR(s.value)} (${s.pct.toFixed(1)}%)`}</title>
              </path>
            ))}
          </svg>
          <div className="space-y-2 text-xs min-w-[170px]">
            {slices.map((s) => (
              <div key={s.label} className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-slate-700 font-medium">{s.label}</span>
                <span className="ml-auto font-bold text-slate-900">
                  {s.pct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMMISSION ENGINE: 4 illustrated steps
// ============================================================================
function EngineStepArt({ n }) {
  const common = {
    viewBox: "0 0 300 110",
    className: "absolute inset-0 w-full h-full",
    preserveAspectRatio: "xMaxYMid slice",
  };
  const defs = (
    <defs>
      <linearGradient id={`es${n}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#0A0A0B" />
        <stop offset="0.55" stopColor="#3B0D0D" />
        <stop offset="1" stopColor="#B91C1C" />
      </linearGradient>
    </defs>
  );
  const art = {
    1: (
      <g>
        <rect
          x="170"
          y="22"
          width="78"
          height="64"
          rx="8"
          fill="#fff"
          opacity=".14"
          transform="rotate(-8 209 54)"
        />
        <rect
          x="190"
          y="16"
          width="78"
          height="64"
          rx="8"
          fill="#fff"
          opacity=".22"
        />
        <path
          d="M204 34h50M204 46h50M204 58h32"
          stroke="#fff"
          strokeWidth="4"
          strokeLinecap="round"
          opacity=".7"
        />
        <circle cx="262" cy="78" r="15" fill="#EF4444" />
        <path
          d="M255 78l5 5 9-10"
          fill="none"
          stroke="#fff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    ),
    2: (
      <g>
        <ellipse cx="220" cy="84" rx="34" ry="10" fill="#EF4444" />
        <ellipse cx="220" cy="72" rx="34" ry="10" fill="#F87171" />
        <ellipse cx="220" cy="60" rx="34" ry="10" fill="#EF4444" />
        <text
          x="220"
          y="64"
          textAnchor="middle"
          fontSize="14"
          fontWeight="900"
          fill="#450A0A"
        >
          ₹
        </text>
        <rect
          x="252"
          y="18"
          width="40"
          height="22"
          rx="6"
          fill="#fff"
          opacity=".9"
        />
        <text
          x="272"
          y="33"
          textAnchor="middle"
          fontSize="11"
          fontWeight="800"
          fill="#B91C1C"
        >
          −5%
        </text>
      </g>
    ),
    3: (
      <g>
        <circle
          cx="232"
          cy="56"
          r="30"
          fill="none"
          stroke="#fff"
          strokeWidth="6"
          opacity=".25"
          strokeDasharray="10 6"
        />
        <circle cx="232" cy="56" r="18" fill="#EF4444" />
        <text
          x="232"
          y="62"
          textAnchor="middle"
          fontSize="18"
          fontWeight="900"
          fill="#fff"
        >
          %
        </text>
        <path
          d="M170 92h60M262 24h28"
          stroke="#fff"
          strokeWidth="5"
          strokeLinecap="round"
          opacity=".5"
        />
        <circle cx="262" cy="24" r="6" fill="#fff" />
      </g>
    ),
    4: (
      <g>
        <rect
          x="186"
          y="62"
          width="18"
          height="30"
          rx="4"
          fill="#fff"
          opacity=".4"
        />
        <rect
          x="212"
          y="46"
          width="18"
          height="46"
          rx="4"
          fill="#fff"
          opacity=".6"
        />
        <rect x="238" y="28" width="18" height="64" rx="4" fill="#F87171" />
        <rect x="264" y="12" width="18" height="80" rx="4" fill="#EF4444" />
        <path
          d="M186 54l26-14 26-14 26-14"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
          opacity=".8"
        />
      </g>
    ),
  }[n];
  return (
    <svg {...common} aria-hidden="true">
      {defs}
      <rect width="300" height="110" fill={`url(#es${n})`} />
      {art}
    </svg>
  );
}

function EngineSteps() {
  const steps = [
    {
      n: 1,
      t: "Pick validated sales",
      d: "Only Validated / Approved transactions in the period are used",
    },
    {
      n: 2,
      t: "Find eligible base",
      d: "Invoice amount minus discounts, returns & excluded items",
    },
    {
      n: 3,
      t: "Apply plan rules",
      d: "Flat %, slab, tier or target-based rule of the assigned plan",
    },
    {
      n: 4,
      t: "Total commission",
      d: "Line commissions are summed per employee / partner",
    },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {steps.map((st) => (
        <div
          key={st.n}
          className="relative overflow-hidden rounded-2xl border border-red-900/40 min-h-[150px] shadow-lg group transition-transform hover:-translate-y-1"
        >
          <EngineStepArt n={st.n} />
          <div className="relative p-4 flex flex-col justify-end h-full min-h-[150px] bg-gradient-to-t from-black/80 via-black/30 to-transparent">
            <span className="w-8 h-8 rounded-lg bg-red-600 text-white text-sm font-extrabold flex items-center justify-center mb-auto shadow-md">
              {st.n}
            </span>
            <div className="text-sm font-extrabold text-white mt-6">{st.t}</div>
            <div className="text-[11px] text-red-100/90 mt-0.5 leading-snug">
              {st.d}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// ADMIN: SUPPORT MESSAGES (everything users wrote through "Contact Us — Any Query?")
// ============================================================================
function ModuleMessages({ notify }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setRows(await api.get("/contact"));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000); // new messages show up by themselves
    return () => clearInterval(timer);
  }, [load]);
  const shown = (rows || []).filter((r) =>
    `${r.name} ${r.email} ${r.topic} ${r.message}`
      .toLowerCase()
      .includes(q.trim().toLowerCase()),
  );
  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">
            Support Messages ({rows ? rows.length : "…"})
          </div>
          <div className="text-[11px] text-slate-500">
            Queries sent by users from "Contact Us — Any Query?". Updates every
            30 seconds.
          </div>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, e-mail, topic or message…"
          className="ml-auto w-full sm:w-80 rounded-xl border border-slate-300 px-3 py-2 text-xs"
        />
        <button
          type="button"
          onClick={() => {
            load();
            notify("Inbox refreshed.");
          }}
          className="px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold"
        >
          Refresh
        </button>
      </div>
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
          {error}
        </div>
      )}
      <div className="space-y-3">
        {shown.map((m) => (
          <div
            key={m.id}
            className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs text-xs space-y-2"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-900">{m.harika}</div>
                <div className="text-slate-500">
                  {m.harikabhargav11@gmail.com}
                  {m.phone ? ` · ${m.9000029580}` : ""}
                </div>
              </div>
              <div className="text-right">
                <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-800 font-bold">
                  {m.topic}
                </span>
                <div className="text-[10px] text-slate-400 mt-1">
                  {new Date(m.createdAt).toLocaleString("en-IN")}
                </div>
              </div>
            </div>
            <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">
              {m.message}
            </p>
            <a
              href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.topic} — Auron CommissionOS`)}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold"
            >
              <Mail className="w-3.5 h-3.5" /> Reply by e-mail
            </a>
          </div>
        ))}
        {rows && shown.length === 0 && (
          <div className="py-14 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
            No messages yet.
          </div>
        )}
        {!rows && !error && (
          <div className="py-14 text-center text-xs text-slate-400">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// OPENING ANIMATION (shown when the app opens, before the login page) — styles: "intro-*" in styles.css
// ============================================================================
function IntroSplash({ onSkip }) {
  const letters = "CommissionOS".split("");
  return (
    <div className="intro-root" onClick={onSkip} role="presentation">
      <div className="intro-glow intro-glow-a" />
      <div className="intro-glow intro-glow-b" />
      <div className="intro-grid" />
      <div className="intro-center">
        <div className="intro-mark">
          <span>C</span>
          <i className="intro-ring" />
          <i className="intro-ring intro-ring-2" />
        </div>
        <h1 className="intro-title" aria-label="CommissionOS">
          {letters.map((c, i) => (
            <span
              key={i}
              style={{ animationDelay: `${0.45 + i * 0.07}s` }}
              className={i >= 10 ? "intro-red" : ""}
            >
              {c}
            </span>
          ))}
        </h1>
        <p className="intro-tag">Commission management, simplified</p>
        <div className="intro-bar">
          <b />
        </div>
        <small className="intro-skip">Click anywhere to skip</small>
      </div>
    </div>
  );
}

// ============================================================================
// AUDIT HISTORY (view-only users): approval trail of the authorised records they are allowed to see
// ============================================================================
function ModuleAuditHistory({ audit, org }) {
  const [kind, setKind] = useState("All");
  const [q, setQ] = useState("");
  const kinds = ["All", "Statement", "Adjustment", "Payout", "Dispute"];
  const rows = audit.filter(
    (a) =>
      (kind === "All" || a.kind === kind) &&
      `${a.ref} ${a.title} ${a.status}`
        .toLowerCase()
        .includes(q.trim().toLowerCase()),
  );
  const tone = {
    Statement: "bg-red-100 text-red-800",
    Adjustment: "bg-emerald-100 text-emerald-800",
    Payout: "bg-slate-900 text-white",
    Dispute: "bg-amber-100 text-amber-800",
  };
  return (
    <div className="space-y-5">
      <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-950 flex items-center gap-2.5">
        <ShieldCheck className="w-4 h-4 text-red-600 shrink-0" />
        <span>
          <strong>Audit history</strong> of the records that have been
          authorised (approved statements, paid payouts, approved adjustments,
          resolved disputes). You have view-only access.
        </span>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              data-allow="all"
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${kind === k ? "bg-[#0A0A0B] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              {k}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search reference, name or status…"
          className="ml-auto w-full sm:w-72 rounded-xl border border-slate-300 px-3 py-2 text-xs"
        />
        <button
          type="button"
          data-allow="all"
          onClick={() =>
            downloadCSV(
              "Audit_History.csv",
              [
                "Reference",
                "Type",
                "Record",
                "Status",
                "Date",
                "Amount",
                "Actor",
                "Note",
                "Time",
              ],
              rows.flatMap((a) =>
                (a.events.length ? a.events : [{}]).map((e) => [
                  a.ref,
                  a.kind,
                  a.title,
                  a.status,
                  a.date,
                  a.amount,
                  e.author || "",
                  e.text || "",
                  e.time || e.date || "",
                ]),
              ),
            )
          }
          className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {rows.map((a) => (
          <div
            key={`${a.kind}-${a.ref}`}
            className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3 text-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${tone[a.kind] || "bg-slate-100 text-slate-700"}`}
                >
                  {a.kind}
                </span>
                <div className="font-bold text-red-600 mt-1.5">{a.ref}</div>
                <div className="text-sm font-bold text-slate-900">
                  {a.title}
                </div>
              </div>
              <div className="text-right">
                <div className="font-extrabold text-slate-900">
                  {formatINR(a.amount)}
                </div>
                <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                  {a.status}
                </span>
              </div>
            </div>
            {a.events.length > 0 ? (
              <ol className="relative border-l-2 border-red-200 ml-2 space-y-2.5">
                {a.events.map((e, i) => (
                  <li key={i} className="ml-4 relative">
                    <span className="absolute -left-[22px] top-1 w-3 h-3 rounded-full bg-red-600 ring-4 ring-white" />
                    <div className="font-bold text-slate-800">
                      {e.author || "System"}
                    </div>
                    {e.text && <p className="text-slate-600">{e.text}</p>}
                    <div className="text-[10px] text-slate-400">
                      {e.time || e.date || a.date}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="text-slate-400">No history notes recorded.</div>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="xl:col-span-2 py-14 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
            No authorised records match.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// EMPLOYEE: MY PROFILE & COMMISSION (own details, joining date, commission + how it is calculated)
// ============================================================================
function tenureOf(joiningDate) {
  const iso =
    dmyToIso(joiningDate) ||
    (/^\d{4}-\d{2}-\d{2}$/.test(joiningDate || "") ? joiningDate : "");
  if (!iso) return "";
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return "";
  const now = new Date();
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return "Joining soon";
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} year${y > 1 ? "s" : ""}`);
  if (m || !y) parts.push(`${m} month${m === 1 ? "" : "s"}`);
  return parts.join(" ");
}

function ModuleMyProfile({
  session,
  employees,
  policies,
  transactions,
  statements,
  payouts,
  reversals,
  adjustments,
  disputes,
  engine,
  setActiveModule,
  onEmployeeSaved,
  notify,
}) {
  const lc = (v) =>
    String(v || "")
      .trim()
      .toLowerCase();
  const me = useMemo(() => {
    const byEmail = employees.find((e) => lc(e.email) === lc(session.email));
    if (byEmail) return byEmail;
    const byName = employees.filter((e) => lc(e.name) === lc(session.name));
    return byName.length === 1 ? byName[0] : null;
  }, [employees, session]);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setPhone(me ? me.phone || "" : "");
  }, [me && me.id, me && me.phone]);

  if (!me) {
    return (
      <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-6 text-xs text-amber-900 space-y-1">
        <div className="text-sm font-bold">
          Your login is not linked to an employee record yet
        </div>
        <p>
          Signed in as <strong>{session.name}</strong> ({session.email}). Ask
          your admin to add an employee with this e-mail in{" "}
          <em>Employees &amp; Partners</em>, then refresh this page.
        </p>
      </div>
    );
  }

  const policy = policies.find((p) => p.id === me.planId) || null;
  const mine = (name) => lc(name) === lc(me.name);
  const myTxns = transactions.filter(
    (t) => t.salespersonId === me.id || mine(t.salesperson) || mine(t.referrer),
  );
  const myStmts = statements.filter(
    (s) => s.employeeId === me.id || mine(s.employee),
  );
  const myPayouts = payouts.filter((x) => mine(x.employee));
  const myReversals = reversals.filter((x) => mine(x.employee));
  const myAdjustments = adjustments.filter((x) => mine(x.employee));
  const myDisputes = disputes.filter((x) => mine(x.employee));
  const run = (engine.results || []).find(
    (r) => r.employeeId === me.id || mine(r.employeeName),
  );

  // live calculation from my validated transactions with the plan assigned to me
  const validated = myTxns.filter((t) => t.status === "Validated");
  const eligibleBase = validated.reduce(
    (s, t) => s + (Number(t.eligibleBase) || 0),
    0,
  );
  const live = computePolicyCommission(policy, eligibleBase, validated.length);
  const target = Number(me.monthlyTarget) || 0;
  const attainment = target
    ? Math.round(((Number(me.eligibleSales) || 0) / target) * 100)
    : null;
  const tenure = tenureOf(me.joiningDate);
  const initials = me.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const savePhone = async () => {
    setSaving(true);
    try {
      const updated = await api.put(`/employees/${encodeURIComponent(me.id)}`, {
        ...me,
        phone,
      });
      onEmployeeSaved(updated);
      notify("Phone number updated.");
    } catch (err) {
      notify(err.message, "error");
    }
    setSaving(false);
  };

  const th = "whitespace-nowrap py-3 px-4";
  const td = "whitespace-nowrap py-3 px-4";
  const badge = (txt, tone = "slate") => {
    const map = {
      green: "bg-emerald-100 text-emerald-800",
      amber: "bg-amber-100 text-amber-800",
      rose: "bg-rose-100 text-rose-800",
      slate: "bg-slate-100 text-slate-700",
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full font-semibold ${map[tone]}`}>
        {txt}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0A0A0B] via-[#3B0D0D] to-[#DC2626] text-white p-7 shadow-lg">
        <div className="relative flex flex-wrap items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center text-xl font-extrabold">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="text-xs text-red-200 font-semibold">
              Welcome back
            </div>
            <h2 className="text-2xl font-extrabold truncate">{me.name}</h2>
            <div className="text-xs text-red-100">
              {me.email} · {me.department} · {me.type}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <span className="px-3 py-1 rounded-full bg-white/15 text-[11px] font-bold">
              {me.id}
            </span>
            <span className="px-3 py-1 rounded-full bg-white/15 text-[11px] font-bold">
              Joined {me.joiningDate || "—"}
              {tenure ? ` · ${tenure}` : ""}
            </span>
            <span className="px-3 py-1 rounded-full bg-emerald-400/90 text-emerald-950 text-[11px] font-extrabold">
              {me.status}
            </span>
          </div>
        </div>
      </div>

      {/* commission summary */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {[
          [
            "Eligible Sales",
            formatINR(me.eligibleSales),
            "text-slate-900 bg-white",
          ],
          [
            "Earned Commission",
            formatINR(me.earnedCommission),
            "text-red-700 bg-red-50",
          ],
          [
            "Pending",
            formatINR(me.pendingCommission),
            "text-amber-700 bg-amber-50",
          ],
          [
            "Approved",
            formatINR(me.approvedCommission),
            "text-slate-900 bg-slate-100",
          ],
          [
            "Paid",
            formatINR(me.paidCommission),
            "text-emerald-700 bg-emerald-50",
          ],
          [
            "Target Attainment",
            attainment === null ? "—" : `${attainment}%`,
            "text-slate-900 bg-white",
          ],
        ].map(([l, v, c]) => (
          <div
            key={l}
            className={`rounded-2xl border border-slate-200 p-4 ${c.split(" ")[1]}`}
          >
            <div className="text-[11px] font-semibold uppercase text-slate-500">
              {l}
            </div>
            <div className={`text-xl font-extrabold mt-1 ${c.split(" ")[0]}`}>
              {v}
            </div>
          </div>
        ))}
      </div>

      {/* details */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-slate-900">My Details</h3>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
            <Lock className="w-3.5 h-3.5" /> Only your phone number can be
            edited — ask your admin for anything else
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["Employee ID", me.id],
            ["Full Name", me.name],
            ["Email (login)", me.email],
            ["Department", me.department],
            ["Branch", me.branch],
            ["Reporting Manager", me.manager],
            ["Type", me.type],
            ["Eligibility", me.eligibility],
            ["Joining Date", me.joiningDate],
            ["Time with us", tenure || "—"],
            ["Exit Date", me.exitDate || "Currently working"],
            [
              "Commission Plan",
              policy ? `${policy.name} (${policy.version})` : me.planName,
            ],
            ["Monthly Target", formatINR(me.monthlyTarget)],
          ].map(([k, v]) => (
            <div
              key={k}
              className="rounded-xl bg-slate-50 border border-slate-200 p-3.5"
            >
              <div className="text-[10px] uppercase font-semibold text-slate-500">
                {k}
              </div>
              <div className="text-sm font-bold text-slate-900 mt-0.5 break-words">
                {v || "—"}
              </div>
            </div>
          ))}
          <div
            className="rounded-xl bg-red-50 border border-red-200 p-3.5"
            data-allow="employee"
          >
            <div className="text-[10px] uppercase font-semibold text-red-700">
              Phone (you can edit)
            </div>
            <div className="flex gap-1.5 mt-1">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={20}
                className="w-full min-w-0 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-sm font-bold"
              />
              <button
                type="button"
                disabled={saving || phone === (me.phone || "")}
                onClick={savePhone}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-bold whitespace-nowrap"
              >
                {saving ? "Saving…" : "Save phone"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* how commission is calculated */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900">
            How my commission is calculated
          </h3>
          <p className="text-xs text-slate-500">
            Plan:{" "}
            <strong>
              {policy
                ? `${policy.name} — ${policy.modelLabel || `Model ${policy.model}`}`
                : me.planName || "No plan assigned"}
            </strong>
            {policy && policy.description ? ` · ${policy.description}` : ""}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-xs space-y-2.5">
          <div className="flex gap-2 items-start">
            <span className="w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
              1
            </span>
            <span className="text-slate-700">
              Validated sales after discounts:{" "}
              <strong>{validated.length}</strong> transaction(s), eligible base
              = <strong>{formatINR(eligibleBase)}</strong>
            </span>
          </div>
          <div className="flex gap-2 items-start">
            <span className="w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
              2
            </span>
            <span className="text-slate-700">
              Plan rule applied:{" "}
              <span className="font-mono text-[11px] bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                {run ? run.formulaSummary : live.breakdown}
              </span>
            </span>
          </div>
          <div className="flex gap-2 items-start">
            <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
              3
            </span>
            <span className="text-slate-700">
              Commission from this run ={" "}
              <strong className="text-emerald-700">
                {formatINR(run ? run.calculatedCommission : live.commission)}
              </strong>
              {run
                ? " (latest Commission Engine run)"
                : " (live estimate from your validated sales)"}
            </span>
          </div>
          <div className="flex gap-2 items-start">
            <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
              4
            </span>
            <span className="text-slate-700">
              Net payable on a statement = Gross commission − Reversals ±
              Adjustments − Deductions (see the table below)
            </span>
          </div>
        </div>
        {run && run.txnDetails && run.txnDetails.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                  <th className={th}>Transaction</th>
                  <th className={th}>Product</th>
                  <th className={`${th} text-right`}>Eligible Base</th>
                  <th className={th}>Rule</th>
                  <th className={`${th} text-right`}>Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {run.txnDetails.map((d) => (
                  <tr key={d.txnId}>
                    <td className={`${td} font-bold text-red-600`}>
                      {d.txnId} ({d.invoice})
                    </td>
                    <td className={td}>{d.product}</td>
                    <td className={`${td} text-right`}>{formatINR(d.base)}</td>
                    <td className={`${td} text-slate-600`}>{d.formula}</td>
                    <td className={`${td} text-right font-bold`}>
                      {formatINR(d.commission)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* statements */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">
            My Commission Statements ({myStmts.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                <th className={th}>Statement</th>
                <th className={th}>Period</th>
                <th className={th}>Policy</th>
                <th className={`${th} text-right`}>Eligible Sales</th>
                <th className={th}>Rate</th>
                <th className={`${th} text-right`}>Gross</th>
                <th className={`${th} text-right`}>Reversals</th>
                <th className={`${th} text-right`}>Adjustments</th>
                <th className={`${th} text-right`}>Deductions</th>
                <th className={`${th} text-right`}>Net Payable</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {myStmts.map((s) => (
                <tr key={s.id}>
                  <td className={`${td} font-bold text-red-600`}>{s.id}</td>
                  <td className={td}>{s.period}</td>
                  <td className={td}>{s.policyApplied}</td>
                  <td className={`${td} text-right`}>
                    {formatINR(s.eligibleSales)}
                  </td>
                  <td className={td}>{s.commissionRate}</td>
                  <td className={`${td} text-right`}>
                    {formatINR(s.grossCommission)}
                  </td>
                  <td className={`${td} text-right text-rose-600`}>
                    {formatINR(s.reversals)}
                  </td>
                  <td className={`${td} text-right`}>
                    {formatINR(s.adjustments)}
                  </td>
                  <td className={`${td} text-right`}>
                    {formatINR(s.deductions)}
                  </td>
                  <td className={`${td} text-right font-extrabold`}>
                    {formatINR(s.netPayable)}
                  </td>
                  <td className={td}>
                    {badge(
                      s.status,
                      s.status === "Approved"
                        ? "green"
                        : s.status === "Rejected"
                          ? "rose"
                          : "amber",
                    )}
                  </td>
                </tr>
              ))}
              {myStmts.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-slate-400">
                    No commission statements yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* sales + payouts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100">
            <h3 className="text-base font-bold text-slate-900">
              My Sales ({myTxns.length})
            </h3>
          </div>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                  <th className={th}>Transaction</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Date</th>
                  <th className={`${th} text-right`}>Eligible Base</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myTxns.map((x) => (
                  <tr key={x.id}>
                    <td className={`${td} font-bold text-red-600`}>{x.id}</td>
                    <td className={td}>{x.customer}</td>
                    <td className={td}>{x.date}</td>
                    <td className={`${td} text-right font-bold`}>
                      {formatINR(x.eligibleBase)}
                    </td>
                    <td className={td}>
                      {badge(
                        x.status,
                        x.status === "Validated" ? "green" : "amber",
                      )}
                    </td>
                  </tr>
                ))}
                {myTxns.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-10 text-center text-slate-400"
                    >
                      No sales found for you.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-2">
            <h3 className="text-base font-bold text-slate-900">
              My Payouts ({myPayouts.length})
            </h3>
            <span className="text-[11px] text-slate-500">
              {myReversals.length} reversal(s) · {myAdjustments.length}{" "}
              adjustment(s) · {myDisputes.length} dispute(s)
            </span>
          </div>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                  <th className={th}>Payout</th>
                  <th className={th}>Statement</th>
                  <th className={`${th} text-right`}>Paid</th>
                  <th className={th}>Date</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myPayouts.map((x) => (
                  <tr key={x.id}>
                    <td className={`${td} font-bold text-red-600`}>{x.id}</td>
                    <td className={td}>{x.statementId}</td>
                    <td className={`${td} text-right font-bold`}>
                      {formatINR(x.bankPaidAmount)}
                    </td>
                    <td className={td}>{x.paymentDate}</td>
                    <td className={td}>
                      {badge(x.status, x.status === "Paid" ? "green" : "amber")}
                    </td>
                  </tr>
                ))}
                {myPayouts.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-10 text-center text-slate-400"
                    >
                      No payouts recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-900 flex flex-wrap items-center justify-between gap-3">
        <span>
          Something looks wrong in a statement? You can raise a dispute — the
          admin will review it.
        </span>
        <button
          type="button"
          data-allow="all"
          onClick={() => setActiveModule("disputes")}
          className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold"
        >
          Go to Disputes →
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// ADMIN: USERS & LOGIN ACTIVITY (who signed in + account management)
// ============================================================================
function ModuleAccessControl({ session, notify }) {
  const [accounts, setAccounts] = useState([]);
  const [loginActivity, setLoginActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [newAcc, setNewAcc] = useState({
    name: "",
    email: "",
    password: "",
    role: "user",
  });
  const admins = accounts.filter(
    (a) => a.role === "admin" && a.status === "Active",
  ).length;
  const today = new Date().toDateString();
  const loginsToday = loginActivity.filter(
    (l) => new Date(l.time).toDateString() === today,
  ).length;
  const inputCls =
    "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none";

  const load = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([
        api.get("/admin/accounts"),
        api.get("/admin/login-activity"),
      ]);
      setAccounts(a);
      setLoginActivity(l);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const createAccount = async (e) => {
    e.preventDefault();
    const email = newAcc.email.trim().toLowerCase();
    if (
      !newAcc.name.trim() ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      newAcc.password.length < 6
    )
      return notify(
        "Enter name, a valid email and a password of 6+ characters.",
        "error",
      );
    try {
      await api.post("/admin/accounts", { ...newAcc, email });
      setNewAcc({ name: "", email: "", password: "", role: "user" });
      notify(`Account created for ${email} as ${newAcc.role}.`);
      await load();
    } catch (err) {
      notify(err.message, "error");
    }
    return undefined;
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/admin/accounts/${editing.id}`, {
        name: editing.name,
        role: editing.role,
        status: editing.status,
        ...(editing.newPassword ? { newPassword: editing.newPassword } : {}),
      });
      setEditing(null);
      notify("Account updated.");
      await load();
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const removeAccount = async (a) => {
    if (a.email === session.email)
      return notify("You cannot delete your own account.", "error");
    if (!window.confirm(`Delete account ${a.email}?`)) return undefined;
    try {
      await api.del(`/admin/accounts/${a.id}`);
      notify(`Account ${a.email} deleted.`);
      await load();
    } catch (err) {
      notify(err.message, "error");
    }
    return undefined;
  };

  const clearLog = async () => {
    if (!window.confirm("Clear the entire login activity log?")) return;
    try {
      await api.del("/admin/login-activity");
      setLoginActivity([]);
      notify("Login activity cleared.");
    } catch (err) {
      notify(err.message, "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0A0A0B] via-[#3B0D0D] to-[#DC2626] bg-animate text-white p-7 shadow-lg">
        <div className="absolute -right-8 -top-8 w-48 h-48 rounded-full bg-white/10 blur-2xl float-slow" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 border border-white/20 text-[11px] font-bold">
            <ShieldCheck className="w-3.5 h-3.5" /> Admin only
          </span>
          <h2 className="text-2xl font-extrabold mt-2">
            Users & Login Activity
          </h2>
          <p className="text-xs text-blue-100 mt-1">
            See who has signed in, review their details, and edit, suspend or
            remove accounts.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ["Total Accounts", accounts.length, "from-slate-800 to-slate-700"],
          [
            "Admins",
            accounts.filter((a) => a.role === "admin").length,
            "from-rose-600 to-pink-600",
          ],
          [
            "Users / Employees",
            accounts.filter((a) => a.role !== "admin").length,
            "from-emerald-600 to-teal-600",
          ],
          ["Logins Today", loginsToday, "from-blue-600 to-indigo-600"],
        ].map(([l, v, g]) => (
          <div
            key={l}
            className="rounded-2xl bg-white border border-slate-200 p-4 flex items-center gap-3 shadow-xs"
          >
            <div
              className={`w-11 h-11 rounded-xl bg-gradient-to-br ${g} text-white font-extrabold text-lg flex items-center justify-center`}
            >
              {v}
            </div>
            <div className="text-xs font-semibold text-slate-600 leading-tight">
              {l}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={createAccount}
        className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4"
      >
        <h3 className="text-base font-bold text-slate-900">Create Account</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <input
            value={newAcc.name}
            onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })}
            placeholder="Full name"
            className={inputCls}
          />
          <input
            type="email"
            value={newAcc.email}
            onChange={(e) => setNewAcc({ ...newAcc, email: e.target.value })}
            placeholder="Email"
            className={inputCls}
          />
          <input
            type="password"
            value={newAcc.password}
            onChange={(e) => setNewAcc({ ...newAcc, password: e.target.value })}
            placeholder="Temporary password"
            className={inputCls}
          />
          <select
            value={newAcc.role}
            onChange={(e) => setNewAcc({ ...newAcc, role: e.target.value })}
            className={inputCls}
          >
            <option value="user">User (view only)</option>
            <option value="admin">Admin (full access)</option>
          </select>
          <button
            type="submit"
            className="py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
          >
            + Create
          </button>
        </div>
      </form>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">
            Registered Accounts
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                {[
                  "Name",
                  "Email",
                  "Role",
                  "Method",
                  "Status",
                  "Created",
                  "Last Login",
                  "Logins",
                  "Actions",
                ].map((h) => (
                  <th key={h} className="whitespace-nowrap py-3 px-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap py-3 px-4 font-bold text-slate-900">
                    {a.name}
                    {a.email === session.email && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px]">
                        YOU
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4 text-slate-600">
                    {a.email}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4">
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-semibold ${a.role === "admin" ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}
                    >
                      {a.role === "admin" ? "Admin" : "User"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-3 px-4">{a.provider}</td>
                  <td className="whitespace-nowrap py-3 px-4">
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-semibold ${a.status === "Active" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-3 px-4 text-slate-500">
                    {fmtDateTime(a.createdAt)}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4 text-slate-500">
                    {fmtDateTime(a.lastLogin)}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4 font-bold">
                    {a.loginCount || 0}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing({ ...a, newPassword: "" })}
                        className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-bold hover:bg-blue-100 flex items-center gap-1"
                      >
                        <Edit3 className="w-3 h-3" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAccount(a)}
                        className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-bold hover:bg-rose-100 flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Login Activity
            </h3>
            <p className="text-xs text-slate-500">
              Latest sign-ins recorded on the server (all devices).
            </p>
          </div>
          {loginActivity.length > 0 && (
            <button
              type="button"
              onClick={clearLog}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700"
            >
              Clear log
            </button>
          )}
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 sticky top-0">
                {["Time", "Name", "Email", "Role", "Method", "Portal"].map(
                  (h) => (
                    <th key={h} className="whitespace-nowrap py-3 px-4">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loginActivity.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    No sign-ins recorded yet.
                  </td>
                </tr>
              )}
              {loginActivity.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap py-3 px-4 text-slate-600">
                    {fmtDateTime(l.time)}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4 font-bold text-slate-900">
                    {l.name}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4 text-slate-600">
                    {l.email}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4">
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-semibold ${l.role === "admin" ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}
                    >
                      {l.role === "admin" ? "Admin" : "User"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-3 px-4">{l.provider}</td>
                  <td className="whitespace-nowrap py-3 px-4 text-slate-500">
                    {l.page}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={saveEdit}
            className="modal-pop bg-white rounded-2xl w-full max-w-md p-6 space-y-4 text-xs shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Edit Account
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-slate-500">{editing.email}</div>
            <div>
              <label className="font-semibold block mb-1">Name</label>
              <input
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold block mb-1">Role</label>
                <select
                  value={editing.role}
                  onChange={(e) =>
                    setEditing({ ...editing, role: e.target.value })
                  }
                  className={inputCls}
                >
                  <option value="user">User (view only)</option>
                  <option value="admin">Admin (full access)</option>
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">Status</label>
                <select
                  value={editing.status}
                  onChange={(e) =>
                    setEditing({ ...editing, status: e.target.value })
                  }
                  className={inputCls}
                >
                  <option>Active</option>
                  <option>Suspended</option>
                </select>
              </div>
            </div>
            <div>
              <label className="font-semibold block mb-1">
                Reset password{" "}
                <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                type="password"
                value={editing.newPassword}
                onChange={(e) =>
                  setEditing({ ...editing, newPassword: e.target.value })
                }
                placeholder="New password"
                className={inputCls}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function App() {
  // Authentication & Workspace Session State
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(() => !!tokenStore.get());
  const [authConfig, setAuthConfig] = useState({
    googleClientId: "",
    demoGoogle: false,
  });
  const [dataReady, setDataReady] = useState(false);

  const [loadError, setLoadError] = useState("");
  const [hash, setHash] = useState(() =>
    typeof window !== "undefined" ? window.location.hash.toLowerCase() : "",
  );
  useEffect(() => {
    const onHash = () => setHash(window.location.hash.toLowerCase());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // only #admin and #employee are portal addresses; anything else (e.g. #partner) is the plain Partner address
  useEffect(() => {
    if (hash && hash !== "#admin" && hash !== "#employee") {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setHash("");
    }
  }, [hash]);
  // opening animation (styles: "intro-*" in styles.css): plays on every fresh open, then moves on by itself
  const [introDone, setIntroDone] = useState(false);
  useEffect(() => {
    if (introDone) return undefined;
    const t = setTimeout(() => setIntroDone(true), 3400); // matches the CSS fade-out (2.7s + .6s)
    return () => clearTimeout(t);
  }, [introDone]);
  const loginMode =
    hash === "#admin" ? "admin" : hash === "#employee" ? "employee" : "user";
  const authRole = session ? session.role : null;
  ACCESS = authRole || "admin"; // read by the data hooks: view-only users / employees cannot send changes
  const isAdmin = authRole === "admin";
  const isEmployee = authRole === "employee";
  const isPartner = authRole === "user"; // the non-admin "user" role is shown as "Partner"
  const currentUser = session
    ? {
      name: session.name,
      email: session.email,
      role: isPartner ? "Partner" : session.roleLabel,
    }
    : { name: "", email: "", role: "" };

  // Active Module & Role View State
  const [activeModule, setActiveModule] = usePersistentState(
    "activeModule",
    "dashboard",
  );
  const [roleView, setRoleView] = usePersistentState("roleView", "owner"); // 'owner' | 'salesperson'
  const [inviteToken] = useState(() => {
    try {
      return typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("invite")
        : null;
    } catch (err) {
      return null;
    }
  });
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteError, setInviteError] = useState("");
  const [inviteDone, setInviteDone] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // Core Global Enterprise State
  const [org, setOrg, hydrateOrg] = useSyncedObject("org", seedData.org || {});
  const [subscription, setSubscription, hydrateSubscription] = useSyncedObject(
    "subscription",
    seedData.subscription || {},
  );
  const [departments, setDepartments, hydrateDepartments] = useSyncedCollection(
    "departments",
    "id",
    "asc",
    seedData.departments || [],
  );
  const [users, setUsers, hydrateUsers] = useSyncedCollection(
    "users",
    "id",
    "asc",
    seedData.users || [],
  );
  const [rolePermissions, setRolePermissions, hydrateRolePermissions] =
    useSyncedCollection(
      "rolePermissions",
      "role",
      "asc",
      seedData.rolePermissions || [],
    );
  const [employees, setEmployees, hydrateEmployees] = useSyncedCollection(
    "employees",
    "id",
    "asc",
    seedData.employees || [],
  );
  const [policies, setPolicies, hydratePolicies] = useSyncedCollection(
    "policies",
    "id",
    "asc",
    seedData.policies || [],
  );
  const [transactions, setTransactions, hydrateTransactions] =
    useSyncedCollection(
      "transactions",
      "id",
      "desc",
      seedData.transactions || [],
    );
  const [reversals, setReversals, hydrateReversals] = useSyncedCollection(
    "reversals",
    "id",
    "desc",
    seedData.reversals || [],
  );
  const [adjustments, setAdjustments, hydrateAdjustments] = useSyncedCollection(
    "adjustments",
    "id",
    "desc",
    seedData.adjustments || [],
  );
  const [statements, setStatements, hydrateStatements] = useSyncedCollection(
    "statements",
    "id",
    "desc",
    seedData.statements || [],
  );
  const [payouts, setPayouts, hydratePayouts] = useSyncedCollection(
    "payouts",
    "id",
    "desc",
    seedData.payouts || [],
  );
  const [disputes, setDisputes, hydrateDisputes] = useSyncedCollection(
    "disputes",
    "id",
    "desc",
    seedData.disputes || [],
  );
  const [billingInvoices, setBillingInvoices, hydrateBillingInvoices] =
    useSyncedCollection(
      "billingInvoices",
      "id",
      "desc",
      seedData.billingInvoices || [],
    );
  const [calcRuns, setCalcRuns] = useState(seedData.calcRuns || []); // created by the engine endpoint
  const [engine, setEngine] = useState(
    seedData.engine || { results: [], exceptions: [] },
  );
  const [audit, setAudit] = useState(seedData.audit || []); // audit history (view-only users)

  const loadWorkspace = useCallback(async () => {
    setLoadError("");
    try {
      const d = await api.get("/bootstrap");
      hydrateOrg(d.org);
      hydrateSubscription(d.subscription);
      hydrateDepartments(d.departments);
      hydrateUsers(d.users);
      hydrateRolePermissions(d.rolePermissions);
      hydrateEmployees(d.employees);
      hydratePolicies(d.policies);
      hydrateTransactions(d.transactions);
      hydrateReversals(d.reversals);
      hydrateAdjustments(d.adjustments);
      hydrateStatements(d.statements);
      hydratePayouts(d.payouts);
      hydrateDisputes(d.disputes);
      hydrateBillingInvoices(d.billingInvoices);
      setCalcRuns(d.calcRuns);
      setEngine(d.engine);
      setAudit(d.audit || []);
      setDataReady(true);
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  // restore the session from the saved token, or load login configuration
  useEffect(() => {
    api
      .get("/auth/config")
      .then(setAuthConfig)
      .catch (() => { });
  if (!tokenStore.get()) {
    setBooting(false);
    return;
  }
  api
    .get("/auth/me")
    .then((r) => {
      setSession(r.user);
      loadWorkspace();
    })
    .catch(() => {
      tokenStore.clear();
      setSession(null);
    })
    .finally(() => setBooting(false));
}, [loadWorkspace]);

// everybody who signs in sees the same workspace the admin sees (employees / users: read-only, see viewOnly.js)
useEffect(() => {
  if (session && tokenStore.get()) loadWorkspace();
}, [session, loadWorkspace]);

// after sign-in the address shows the portal the person belongs to (#admin / #employee / plain for users)
useEffect(() => {
  if (!session) return;
  const want =
    session.role === "admin"
      ? "#admin"
      : session.role === "employee"
        ? "#employee"
        : "";
  if (window.location.hash.toLowerCase() !== want) {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${want}`,
    );
    setHash(want);
  }
}, [session]);

// hides edit / delete / approve... controls for view-only users and employees (the server refuses those writes anyway)
const mainRef = useRef(null);
// opening a module always starts at the top of the page (not where the previous module was scrolled to)
useEffect(() => {
  window.scrollTo(0, 0);
  let el = mainRef.current;
  while (el) {
    el.scrollTop = 0;
    el = el.parentElement;
  }
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}, [activeModule]);
useEffect(
  () => startViewOnlyGuard(mainRef.current, authRole || "admin"),
  [authRole, dataReady, activeModule],
);

// invitation link (?invite=token)
useEffect(() => {
  if (!inviteToken) return;
  api
    .get(`/invites/${inviteToken}`)
    .then(setInviteInfo)
    .catch((e) => setInviteError(e.message));
}, [inviteToken]);

const notify = (message, type = "success") => {
  setToast({ message, type });
  setTimeout(() => setToast(null), 3500);
};
useEffect(() => {
  const onBlocked = () =>
    notify("You have view-only access to this section.", "error");
  window.addEventListener("view-only-blocked", onBlocked);
  return () => window.removeEventListener("view-only-blocked", onBlocked);
}, []);

// Authentication Handlers (the server checks passwords, roles and portals)
const applySession = (res) => {
  tokenStore.set(res.token);
  setSession(res.user);
  setRoleView(res.user.role === "admin" ? "owner" : "salesperson");
  setActiveModule(res.user.role === "employee" ? "myprofile" : "dashboard");
  setMobileMenuOpen(false);
  notify(`Signed in as ${res.user.name} (${res.user.roleLabel}).`);
};
const authCall = async (path, body) => {
  try {
    applySession(await api.post(path, { ...body, portal: loginMode }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};
const signInWithEmail = (form) => authCall("/auth/login", form);
const registerAccount = (form) => authCall("/auth/register", form);
const googleSignIn = (payload) => authCall("/auth/google", payload);

const handleSignOut = () => {
  tokenStore.clear();
  setSession(null);
  setDataReady(false);
  setMobileMenuOpen(false);
};

const handleInviteAccepted = async (fullName, password) => {
  try {
    const res = await api.post(`/invites/${inviteToken}/accept`, {
      name: fullName,
      password,
    });
    setInviteDone(true);
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch (err) {
      /* ignore */
    }
    applySession(res);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

// server rejected the saved token / a background save failed -> recover
useEffect(() => {
  const onExpired = () => {
    tokenStore.clear();
    setSession(null);
  };
  const onSyncError = (e) => {
    setToast({
      message: `Could not save to the server: ${e.detail && e.detail.message}. Reloading latest data…`,
      type: "error",
    });
    setTimeout(() => setToast(null), 4500);
    loadWorkspace();
  };
  window.addEventListener("auth-expired", onExpired);
  window.addEventListener("sync-error", onSyncError);
  return () => {
    window.removeEventListener("auth-expired", onExpired);
    window.removeEventListener("sync-error", onSyncError);
  };
}, [loadWorkspace]);

const applyPayment = (res) => {
  hydrateSubscription(res.subscription);
  hydrateBillingInvoices((prev) => [res.invoice, ...prev]);
};

if (inviteToken && !inviteDone) {
  if (inviteError) {
    return (
      <div className="min-h-screen bg-[#F5F5F6] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-10 max-w-md text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-full bg-rose-100 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-rose-600" />
          </div>
          <h2 className="text-lg font-extrabold text-slate-900">
            Invitation unavailable
          </h2>
          <p className="text-xs text-slate-500">{inviteError}</p>
          <a
            href={window.location.pathname}
            className="inline-block mt-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold"
          >
            Go to sign in
          </a>
        </div>
      </div>
    );
  }
  if (!inviteInfo) return <SplashScreen text="Loading your invitation…" />;
  return (
    <InviteAcceptPage
      invite={{
        n: inviteInfo.name,
        e: inviteInfo.email,
        r: inviteInfo.role,
        o: inviteInfo.orgName,
      }}
      onAccept={handleInviteAccepted}
    />
  );
}

if (booting) return <SplashScreen text="Checking your session…" />;

// opening animation (once per visit, only before sign-in)
if (!session && !introDone)
  return <IntroSplash onSkip={() => setIntroDone(true)} />;

// Not signed in -> login page
if (!session) {
  return (
    <LoginPage
      mode={loginMode}
      authConfig={authConfig}
      onSignIn={signInWithEmail}
      onRegister={registerAccount}
      onGoogle={googleSignIn}
    />
  );
}

if (!dataReady) {
  return (
    <SplashScreen
      text={
        loadError
          ? `Could not load your workspace: ${loadError}`
          : "Loading your workspace…"
      }
      action={loadError ? { label: "Retry", onClick: loadWorkspace } : null}
      secondary={{ label: "Sign out", onClick: handleSignOut }}
    />
  );
}

const activePlan =
  SAAS_PLANS.find((p) => p.id === subscription.planId) || SAAS_PLANS[2];

// Navigation Definition (12 Core Modules + Organisation Settings & Subscription/Billing)
const coreItems = [
  {
    id: "org",
    label: isPartner ? "My Organisation" : "Organisation Settings",
    badge: isPartner ? "" : "Admin",
    icon: Building2,
    roles: ["admin", "user"],
  },
  {
    id: "employees",
    label: "Employees & Partners",
    badge: "M2",
    icon: Users,
    roles: ["admin", "user"],
  },
  {
    id: "policies",
    label: "Commission Policies",
    badge: "M3",
    icon: ShieldCheck,
    roles: ["admin", "employee", "user"],
  },
  {
    id: "transactions",
    label: "Sales Transactions",
    badge: "M4",
    icon: FileSpreadsheet,
    roles: ["admin", "employee", "user"],
  },
  {
    id: "calculator",
    label: "Commission Engine",
    badge: "M5",
    icon: Calculator,
    roles: ["admin", "employee", "user"],
  },
  {
    id: "reversals",
    label: "Returns & Reversals",
    badge: "M6",
    icon: RotateCcw,
    roles: ["admin", "employee", "user"],
  },
  {
    id: "dashboard",
    label: "Commission Dashboard",
    badge: "M7",
    icon: LayoutDashboard,
    roles: ["admin", "employee", "user"],
  },
  {
    id: "statements",
    label: "Commission Statements",
    badge: "M8",
    icon: FileText,
    roles: ["admin", "employee", "user"],
  },
  {
    id: "approvals",
    label: "Approval Workflow",
    badge: "M9",
    icon: CheckCircle2,
    roles: ["admin", "employee", "user"],
  },
  {
    id: "payouts",
    label: "Payouts & Reconciliation",
    badge: "M10",
    icon: Wallet,
    roles: ["admin", "employee", "user"],
  },
  {
    id: "disputes",
    label: "Disputes & Adjustments",
    badge: "M11",
    icon: AlertTriangle,
    roles: ["admin", "employee", "user"],
  },
  {
    id: "reports",
    label: "Reports & Analytics",
    badge: "M12",
    icon: BarChart3,
    roles: ["admin", "employee", "user"],
  },
].filter((i) => i.roles.includes(authRole));

const navGroups = [
  ...(isEmployee
    ? [
      {
        title: "My Account",
        items: [
          {
            id: "myprofile",
            label: "My Profile & Commission",
            badge: "Me",
            icon: User,
          },
        ],
      },
    ]
    : []),
  {
    title: isEmployee ? "My Records" : "Core Incentive Operations",
    items: coreItems,
  },
  ...(!isAdmin && !isEmployee
    ? [
      {
        title: "Compliance",
        items: [
          {
            id: "audit",
            label: "Audit History",
            badge: "Log",
            icon: History,
          },
        ],
      },
    ]
    : []),
  {
    title: "Workspace Administration",
    items: [
      ...(isAdmin
        ? [
          {
            id: "access",
            label: "Users & Login Activity",
            badge: "Admin",
            icon: UserCheck,
          },
        ]
        : []),
      ...(isAdmin
        ? [
          {
            id: "messages",
            label: "Support Messages",
            badge: "Inbox",
            icon: MessageSquare,
          },
        ]
        : []),
      ...(!isEmployee && !isPartner
        ? [
          {
            id: "billing",
            label: isAdmin ? "Subscription & Billing" : "Subscription",
            badge: activePlan.name,
            icon: CreditCard,
          },
        ]
        : []),
      ...(isPartner
        ? [
          {
            id: "contact",
            label: "Contact Us — Any Query?",
            badge: "Help",
            icon: Phone,
          },
        ]
        : []),
    ],
  },
].filter((g) => g.items.length > 0);

const allNavItems = navGroups.flatMap((g) => g.items);

// a partner only ever sees their own records (matched by login email, then by name)
const lcv2 = (v) => String(v || "").trim().toLowerCase();
const myRecord = isPartner
  ? employees.find((e) => lcv2(e.email) === lcv2(session?.email)) ||
  employees.find((e) => lcv2(e.name) === lcv2(session?.name))
  : null;
const mineBy = (list, test) =>
  isPartner ? (myRecord ? list.filter(test) : []) : list;
const scoped = isPartner
  ? {
    employees: myRecord ? [myRecord] : [],
    transactions: mineBy(
      transactions,
      (t) => t.salespersonId === myRecord.id || lcv2(t.salesperson) === lcv2(myRecord.name),
    ),
    statements: mineBy(
      statements,
      (x) => x.employeeId === myRecord.id || lcv2(x.employee) === lcv2(myRecord.name),
    ),
    payouts: mineBy(payouts, (p) => lcv2(p.employee) === lcv2(myRecord.name)),
    reversals: mineBy(reversals, (r) => lcv2(r.employee) === lcv2(myRecord.name)),
    adjustments: mineBy(adjustments, (a) => lcv2(a.employee) === lcv2(myRecord.name)),
  }
  : { employees, transactions, statements, payouts, reversals, adjustments };
// a saved module this role may not open (e.g. "access" for a non-admin) falls back to the home screen
const current = allNavItems.some((n) => n.id === activeModule) || activeModule === "account"
  ? activeModule
  : isEmployee
    ? "myprofile"
    : "dashboard";

// Dynamic Brand Logo Renderer
const renderBrandMark = () => {
  if (org.logoDataUrl) {
    return (
      <img
        src={org.logoDataUrl}
        alt={org.name}
        className="w-9 h-9 rounded-xl object-cover border border-white/20 shadow-sm shrink-0"
      />
    );
  }
  const initials = (org?.name || "Auron CommissionOS")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div
      className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-md shrink-0 border border-white/15"
      style={{ backgroundColor: org.accentColor || "#DC2626" }}
    >
      {initials || "AC"}
    </div>
  );
};

return (
  <div className="min-h-screen bg-[#F5F5F6] text-slate-900 flex font-sans antialiased tabular-nums">
    {/* Toast Notification Banner */}
    {toast && (
      <div
        className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border text-xs font-semibold transition-all ${toast.type === "error"
          ? "bg-rose-950 text-rose-100 border-rose-700"
          : "bg-[#0A0A0B] text-white border-slate-700"
          }`}
      >
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        {toast.message}
      </div>
    )}

    {/* Mobile Sidebar Backdrop */}
    {mobileMenuOpen && (
      <div
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-30 lg:hidden"
        onClick={() => setMobileMenuOpen(false)}
      />
    )}

    {/* ====================================================================
          EXECUTIVE DEEP NAVY SIDEBAR (#0A0A0B)
         ==================================================================== */}
    <aside
      style={{ backgroundColor: org.primaryColor || "#0A0A0B" }}
      className={`fixed lg:sticky lg:top-0 lg:self-start lg:h-screen inset-y-0 left-0 z-40 w-72 text-slate-100 flex flex-col border-r border-white/10 transition-transform duration-200 ${mobileMenuOpen
        ? "translate-x-0"
        : "-translate-x-full lg:translate-x-0"
        }`}
    >
      {/* Dynamic Brand Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {renderBrandMark()}
          <div className="min-w-0">
            <div className="text-sm font-bold text-white truncate tracking-tight">
              {org.productName || "CommissionOS"}
            </div>
            <div className="text-[11px] text-slate-300/80 truncate">
              {org.tagline || "Auron CommissionOS"}
            </div>
          </div>
        </div>
        <button
          className="lg:hidden p-1.5 rounded-lg text-slate-300 hover:bg-white/10"
          onClick={() => setMobileMenuOpen(false)}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Grouped Navigation List */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {navGroups.map((group) => (
          <div key={group.title} className="space-y-0.5">
            <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400/90">
              {group.title}
            </div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = current === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveModule(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${isActive
                    ? "bg-blue-600 text-white shadow-md"
                    : "text-slate-200/90 hover:bg-white/10 hover:text-white"
                    }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${isActive ? "text-white" : "text-slate-300"}`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge ? (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${isActive
                        ? "bg-white/20 text-white"
                        : "bg-black/25 text-slate-300"
                        }`}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Active Plan & Session Footer */}
      <div className="p-3.5 border-t border-white/10 space-y-2.5">
        {/* User Profile with Starting 2 Letters of Email */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setActiveModule("account")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setActiveModule("account");
          }}
          title="View profile details"
          className="flex items-center gap-3 p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer transition"
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-xs text-white shadow-sm shrink-0 border border-white/20 select-none bg-gradient-to-br from-red-600 to-rose-700"
            title={session?.email || "User profile"}
          >
            {(session?.email?.trim().slice(0, 2) || "US").toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-white truncate">
              {session?.name || currentUser.name || "User"}
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {session?.email || currentUser.email || ""}
            </div>
          </div>
          <span
            className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"
            title="Online"
          />
        </div>

        {!isEmployee && !isPartner && (
          <button
            onClick={() => setActiveModule("billing")}
            className="w-full p-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-between text-left transition"
          >
            <div>
              <div className="text-[10px] uppercase tracking-wider text-blue-200 font-semibold">
                SaaS Subscription
              </div>
              <div className="text-xs font-bold text-white">
                {activePlan.name} Plan (
                {subscription.billingCycle === "annual"
                  ? "Annual"
                  : "Monthly"}
                )
              </div>
            </div>
            <Crown className="w-4 h-4 text-amber-300 shrink-0" />
          </button>
        )}

        <div className="flex items-center justify-between text-[11px] text-slate-300 px-1">
          <span>
            {org?.currency || "₹"} •{" "}
            {org?.fiscalYear ? org.fiscalYear.split(" ")[0] : ""}{" "}
            {org?.fiscalYear ? org.fiscalYear.split(" ")[1] : ""}
          </span>
        </div>
      </div>
    </aside>

    {/* ====================================================================
          MAIN CONTENT SHELL & TOP HEADER
         ==================================================================== */}
    <div className="flex-1 flex flex-col min-w-0">
      {/* Top Executive Header Bar */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="hidden sm:flex items-center gap-2 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
              {renderBrandMark()}
              <span className="text-xs font-bold text-slate-800 truncate max-w-[180px]">
                {org.name}
              </span>
            </div>
            <ChevronRight className="hidden sm:block w-4 h-4 text-slate-400 shrink-0" />
            <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">
              {current === "account"
                ? "My Profile"
                : allNavItems.find((n) => n.id === current)?.label}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isEmployee && !isPartner && (
            <button
              onClick={() => setActiveModule("billing")}
              className="hidden md:inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition"
            >
              <Crown className="w-3.5 h-3.5 text-amber-500" />
              {activePlan.name} Plan
            </button>
          )}

          {!isAdmin && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
              <Lock className="w-3 h-3" />{" "}
              {isEmployee ? "Limited edit" : isPartner ? "Partner access" : "View only"}
            </span>
          )}
          <button
            type="button"
            onClick={() => setActiveModule("account")}
            title="View profile"
            className="group hidden md:inline-flex items-center gap-2.5 pl-1.5 pr-3.5 py-1 rounded-full bg-gradient-to-r from-rose-600 via-red-600 to-orange-500 text-white shadow-md hover:shadow-lg hover:scale-[1.03] active:scale-95 transition-all duration-300"
          >
            <span className="relative">
              <span className="w-7 h-7 rounded-full bg-white/25 border border-white/50 flex items-center justify-center text-[11px] font-extrabold">
                {(currentUser.name || session?.email || "U").trim().slice(0, 2).toUpperCase()}
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white animate-pulse" />
            </span>
            <span className="text-left leading-tight">
              <span className="block text-xs font-extrabold">{currentUser.name}</span>
              <span className="block text-[10px] font-semibold text-white/80 tracking-wide uppercase">
                {currentUser.role}
              </span>
            </span>
          </button>

          <ThemeToggle />

          {isAdmin && (
            <button
              onClick={() => setActiveModule("org")}
              className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
              title="Organisation Settings"
            >
              <Sliders className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Active Module Workspace */}
      <main
        ref={mainRef}
        data-module={current}
        data-access={authRole}
        className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto"
        onClick={highlightClickedRow}
      >
        <div key={current} className="anim-module">
          {current === "audit" && (
            <ModuleAuditHistory audit={audit} org={org} />
          )}
          {current === "messages" && <ModuleMessages notify={notify} />}
          {current === "myprofile" && (
            <ModuleMyProfile
              session={session}
              employees={employees}
              policies={policies}
              transactions={transactions}
              statements={statements}
              payouts={payouts}
              reversals={reversals}
              adjustments={adjustments}
              disputes={disputes}
              engine={engine}
              setActiveModule={setActiveModule}
              onEmployeeSaved={(u) =>
                hydrateEmployees((prev) =>
                  prev.map((e) => (e.id === u.id ? u : e)),
                )
              }
              notify={notify}
            />
          )}
          {current === "dashboard" && (
            <ModuleDashboard
              org={org}
              roleView={roleView}
              setRoleView={setRoleView}
              employees={scoped.employees}
              transactions={scoped.transactions}
              statements={scoped.statements}
              reversals={scoped.reversals}
              adjustments={scoped.adjustments}
              onlyMine={isPartner || isEmployee}
              setActiveModule={setActiveModule}
            />
          )}
          {current === "org" && (
            <ModuleOrgSettings
              org={org}
              setOrg={setOrg}
              departments={departments}
              setDepartments={setDepartments}
              users={users}
              setUsers={setUsers}
              rolePermissions={rolePermissions}
              setRolePermissions={setRolePermissions}
              isPartner={isPartner}
              notify={notify}
            />
          )}
          {current === "access" && (
            <ModuleAccessControl session={session} notify={notify} />
          )}
          {current === "account" && (
            <ProfilePage
              session={session}
              roleText={currentUser.role || session?.role}
              accessText={isPartner ? "Partner" : session?.role}
              orgName={org?.name}
              record={employees.find(
                (e) => (e.email || "").toLowerCase() === (session?.email || "").toLowerCase(),
              )}
              onSignOut={handleSignOut}
            />
          )}
          {current === "contact" && (
            <div className="space-y-6">
              <ContactSupportCard
                org={org}
                setOrg={setOrg}
                canEdit={false}
                notify={notify}
                defaultName={session.name}
                defaultEmail={session.email}
              />
            </div>
          )}
          {current === "billing" && (
            <ModuleSubscriptionBilling
              org={org}
              subscription={subscription}
              setSubscription={setSubscription}
              billingInvoices={billingInvoices}
              setBillingInvoices={setBillingInvoices}
              usersCount={users.length}
              transactionsCount={transactions.length}
              policiesCount={policies.length}
              onPaymentRecorded={applyPayment}
              setOrg={setOrg}
              currentUserEmail={session.email}
              currentUserName={session.name}
              accessLevel={authRole}
              notify={notify}
            />
          )}
          {current === "employees" && (
            <ModuleEmployees
              employees={employees}
              setEmployees={setEmployees}
              policies={policies}
              departments={departments}
              isPartner={isPartner}
              notify={notify}
            />
          )}
          {current === "policies" && (
            <ModulePolicies
              policies={policies}
              setPolicies={setPolicies}
              canManage={isAdmin}
              notify={notify}
            />
          )}
          {current === "transactions" && (
            <ModuleTransactions
              transactions={transactions}
              setTransactions={setTransactions}
              employees={employees}
              departments={departments}
              me={
                isAdmin
                  ? null
                  : employees.find((e) => lcv2(e.email) === lcv2(session?.email)) ||
                    employees.find((e) => lcv2(e.name) === lcv2(session?.name)) ||
                    null
              }
              notify={notify}
            />
          )}
          {current === "calculator" && (
            <ModuleCalculator
              employees={employees}
              policies={policies}
              transactions={transactions}
              calcRuns={calcRuns}
              setCalcRuns={setCalcRuns}
              engine={engine}
              setEngine={setEngine}
              isPartner={isPartner}
              canCalculate={isAdmin}
              notify={notify}
            />
          )}
          {current === "reversals" && (
            <ModuleReversals
              transactions={transactions}
              reversals={reversals}
              setReversals={setReversals}
              adjustments={adjustments}
              setAdjustments={setAdjustments}
              setActiveModule={setActiveModule}
              notify={notify}
            />
          )}
          {current === "statements" && (
            <ModuleStatements
              org={org}
              statements={statements}
              setStatements={setStatements}
              transactions={transactions}
              employees={employees}
              policies={policies}
              reversals={reversals}
              adjustments={adjustments}
              notify={notify}
            />
          )}
          {current === "approvals" && (
            <ModuleApprovals
              transactionsTotal={scoped.transactions.length}
              statements={scoped.statements}
              setStatements={setStatements}
              payouts={scoped.payouts}
              setPayouts={setPayouts}
              accessLevel={authRole}
              currentUserName={session.name}
              notify={notify}
            />
          )}
          {current === "payouts" && (
            <ModulePayouts
              payouts={payouts}
              setPayouts={setPayouts}
              statements={statements}
              notify={notify}
            />
          )}
          {current === "disputes" && (
            <ModuleDisputes
              disputes={disputes}
              setDisputes={setDisputes}
              statements={statements}
              transactions={transactions}
              adjustments={adjustments}
              setAdjustments={setAdjustments}
              setActiveModule={setActiveModule}
              accessLevel={authRole}
              currentUserName={session.name}
              employees={employees}
              org={org}
              notify={notify}
            />
          )}
          {current === "reports" && (
            <ModuleReports
              employees={employees}
              transactions={transactions}
              statements={statements}
              payouts={payouts}
              reversals={reversals}
              adjustments={adjustments}
              disputes={disputes}
              policies={policies}
              departments={departments}
              notify={notify}
            />
          )}
        </div>
      </main>
      <AppFooter org={org} />
    </div>
  </div>
);
}

// ============================================================================
// ADDITIONAL SECTION 2: ORGANISATION SETTINGS (BUSINESS, BRAND, TEAMS, RBAC)
// ============================================================================
function DataBackupCard({ notify }) {
  if (ACCESS !== "admin") {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 text-xs text-slate-600 shadow-xs">
        Backup, restore and reset are available to the admin only.
      </div>
    );
  }
  return <AdminDataBackupCard notify={notify} />;
}

function AdminDataBackupCard({ notify }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState("");

  const exportData = async () => {
    setBusy("export");
    try {
      const backup = await api.get("/admin/backup");
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `auron-commissionos-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      notify("Backup file downloaded.");
    } catch (err) {
      notify(err.message, "error");
    }
    setBusy("");
  };

  const importData = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = JSON.parse(reader.result);
        setBusy("restore");
        await api.post("/admin/restore", json);
        notify("Backup restored. Reloading…");
        setTimeout(() => window.location.reload(), 700);
      } catch (err) {
        notify(
          err.message === "Unexpected end of JSON input" ||
            err.name === "SyntaxError"
            ? "This file is not a valid Auron CommissionOS backup."
            : err.message,
          "error",
        );
        setBusy("");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const resetData = async () => {
    if (
      !window.confirm(
        "This permanently deletes ALL business data in the database and restores the demo data. Login accounts are kept. Continue?",
      )
    )
      return;
    setBusy("reset");
    try {
      await api.post("/admin/reset");
      window.location.reload();
    } catch (err) {
      notify(err.message, "error");
      setBusy("");
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
      <div>
        <h3 className="text-base font-bold text-slate-900">Data & Backup</h3>
        <p className="text-xs text-slate-500">
          Everything you add is saved in the PostgreSQL database through the
          Node.js API, so it stays after refresh, restart and on any device.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
          <div className="text-[11px] uppercase font-bold text-emerald-700">
            Database
          </div>
          <div className="text-sm font-extrabold text-emerald-900 mt-1">
            ● PostgreSQL connected
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
          <div className="text-[11px] uppercase font-bold text-slate-500">
            Saving
          </div>
          <div className="text-sm font-extrabold text-slate-900 mt-1">
            Automatic, on every change
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
          <div className="text-[11px] uppercase font-bold text-slate-500">
            Backups
          </div>
          <div className="text-sm font-extrabold text-slate-900 mt-1">
            JSON download / restore
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!!busy}
          onClick={exportData}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-2"
        >
          <Download className="w-4 h-4" />{" "}
          {busy === "export" ? "Preparing…" : "Download Backup"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={importData}
          className="hidden"
        />
        <button
          type="button"
          disabled={!!busy}
          onClick={() => fileRef.current && fileRef.current.click()}
          className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-800 text-xs font-bold flex items-center gap-2"
        >
          <Upload className="w-4 h-4" />{" "}
          {busy === "restore" ? "Restoring…" : "Restore from Backup"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={resetData}
          className="px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 disabled:opacity-60 text-rose-700 text-xs font-bold flex items-center gap-2 ml-auto"
        >
          <Trash2 className="w-4 h-4" /> Reset to Demo Data
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Backups contain business data only (no passwords). Restoring replaces
        all current business data with the file&rsquo;s contents.
      </p>
    </div>
  );
}

function ModuleOrgSettings({
  org,
  setOrg,
  departments,
  setDepartments,
  users,
  setUsers,
  rolePermissions,
  setRolePermissions,
  isPartner = false,
  notify,
}) {
  const [form, setForm] = useState(org);
  const [newDept, setNewDept] = useState({
    name: "",
    head: "",
    members: "",
    budgetTarget: "",
  });
  const [invite, setInvite] = useState({
    email: "",
    name: "",
    role: "Salesperson",
    department: "Sales",
  });
  const [tab, setTab] = useState("profile");
  const fileRef = useRef(null);

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm((prev) => ({ ...prev, logoDataUrl: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveOrg = (e) => {
    e.preventDefault();
    setOrg(form);
    notify(
      "Organisation & Brand Settings saved! Sidebar theme, logo & name updated.",
    );
  };

  const handleAddDept = (e) => {
    e.preventDefault();
    if (!newDept.name.trim()) return;
    setDepartments((prev) => [
      ...prev,
      {
        id: `DEPT0${prev.length + 1}`,
        name: newDept.name,
        head: newDept.head || "Unassigned",
        members: Math.max(1, parseInt(newDept.members, 10) || 1),
        budgetTarget: newDept.budgetTarget || "₹10,00,000",
      },
    ]);
    setNewDept({ name: "", head: "", members: "", budgetTarget: "" });
    notify(`Department "${newDept.name}" created.`);
  };

  const requestInvite = (u) =>
    api.post("/invites", {
      email: u.email,
      name: u.name,
      role: u.role,
      department: u.department,
    });

  // the server creates a one-time link (and e-mails it when SMTP is configured); otherwise we open the mail app
  const openInviteMail = async (u) => {
    try {
      const res = await requestInvite(u);
      if (res.emailed) {
        notify(`Invitation e-mailed to ${u.email}.`);
        return;
      }
      const subject = encodeURIComponent(
        `You're invited to join ${form.name} on Auron CommissionOS`,
      );
      const body = encodeURIComponent(
        `Hi ${u.name},\n\nYou have been invited to join ${form.name} on Auron CommissionOS as ${u.role}.\n\n` +
        `Click the link below to accept your invitation and set up your account:\n${res.link}\n\n` +
        `This link works once and is valid for 7 days. If you were not expecting it, you can ignore this email.\n\nRegards,\n${form.name}`,
      );
      window.location.href = `mailto:${u.email}?subject=${subject}&body=${body}`;
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const handleInviteUser = (e) => {
    e.preventDefault();
    if (!invite.email.trim()) return;
    const created = {
      id: `USR0${users.length + 1}`,
      email: invite.email.trim(),
      name: invite.name || invite.email.split("@")[0],
      role: invite.role,
      department: invite.department,
      status: "Invited",
    };
    setUsers((prev) => [...prev, created]);
    setInvite({
      email: "",
      name: "",
      role: "Salesperson",
      department: "Sales",
    });
    notify(`Creating invitation for ${created.email}…`);
    openInviteMail(created);
  };

  const copyInviteLink = async (u) => {
    try {
      const res = await requestInvite(u);
      await navigator.clipboard?.writeText(res.link);
      notify(`New invitation link for ${u.email} copied.`);
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const togglePermissionCell = (roleIdx, permKey) => {
    if (roleIdx === 0) {
      notify("Admin / Owner retains full system permissions.", "error");
      return;
    }
    setRolePermissions((prev) =>
      prev.map((row, idx) =>
        idx === roleIdx ? { ...row, [permKey]: !row[permKey] } : row,
      ),
    );
    notify("Role permission matrix updated.");
  };

  const inputCls =
    "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none transition";
  const field = (label, node, span = "") => (
    <div className={span}>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
        {label}
      </label>
      {node}
    </div>
  );
  const allTabs = [
    { id: "profile", label: "Company Profile", icon: Building2 },
    { id: "brand", label: "Brand & Theme", icon: Sparkles },
    { id: "rules", label: "Calculation Rules", icon: Calculator },
    { id: "teams", label: "Teams", icon: Layers },
    { id: "users", label: "Users & Invites", icon: Users },
    { id: "permissions", label: "Permissions", icon: Shield },
    { id: "data", label: "Data & Backup", icon: Download },
  ];
  // partners only see the Company Profile tab
  const tabs = isPartner ? allTabs.filter((t) => t.id === "profile") : allTabs;
  const monogram = (form.name || "Org")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const initialsOf = (n = "") =>
    n
      .split(/[ @.]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  const sectionCard =
    "bg-white rounded-2xl border border-slate-200 p-6 shadow-xs";
  const formTabs = ["profile", "brand", "rules"];
  const saveBar = (
    <div className="flex items-center justify-between gap-3 pt-5 mt-5 border-t border-slate-100">
      <p className="text-xs text-slate-500">
        Changes apply to the sidebar, statements and calculations once saved.
      </p>
      <button
        type="submit"
        className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition whitespace-nowrap"
      >
        Save Changes
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-r from-[#0A0A0B] via-[#400C0C] to-[#0A0A0B] text-white p-6 shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          {form.logoDataUrl ? (
            <img
              src={form.logoDataUrl}
              alt="Logo"
              className="w-16 h-16 rounded-2xl object-cover border border-white/30"
            />
          ) : (
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-extrabold text-xl shadow-md border border-white/20"
              style={{ backgroundColor: form.accentColor || "#DC2626" }}
            >
              {monogram}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold tracking-tight truncate">
              {form.name}
            </h2>
            <p className="text-xs text-slate-300 truncate">
              {form.legalEntity}
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {[form.currency, form.fiscalYear, form.industry]
                .filter(Boolean)
                .map((c) => (
                  <span
                    key={c}
                    className="px-2.5 py-0.5 rounded-full bg-white/10 border border-white/15 text-[11px] font-semibold"
                  >
                    {c}
                  </span>
                ))}
            </div>
          </div>
        </div>
        <button
          type="submit"
          form="org-settings-form"
          className="px-5 py-2.5 rounded-xl bg-white text-slate-900 hover:bg-blue-50 text-xs font-bold shadow-sm transition whitespace-nowrap"
        >
          Save Organisation Settings
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200 p-1.5 shadow-xs overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === t.id
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
                  }`}
              >
                <Icon className="w-4 h-4" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Form-based tabs */}
      <form
        id="org-settings-form"
        onSubmit={handleSaveOrg}
        className={formTabs.includes(tab) ? "block" : "hidden"}
      >
        {tab === "profile" && (
          <div className={sectionCard}>
            <h3 className="text-base font-bold text-slate-900">
              Company Profile
            </h3>
            <p className="text-xs text-slate-500 mb-5">
              Legal entity details and tax identifiers used on statements and
              invoices.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {field(
                "Company Name * (shown in the top header)",
                <input
                  required
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls}
                />,
              )}
              {field(
                "Product Name (shown in the left sidebar)",
                <input
                  type="text"
                  placeholder="CommissionOS"
                  value={form.productName ?? "CommissionOS"}
                  onChange={(e) =>
                    setForm({ ...form, productName: e.target.value })
                  }
                  className={inputCls}
                />,
              )}
              {field(
                "Registered Legal Entity",
                <input
                  type="text"
                  value={form.legalEntity}
                  onChange={(e) =>
                    setForm({ ...form, legalEntity: e.target.value })
                  }
                  className={inputCls}
                />,
              )}
              {field(
                "GSTIN Registration",
                <input
                  type="text"
                  value={form.gstin}
                  onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                  className={`${inputCls} font-mono`}
                />,
              )}
              {field(
                "Corporate PAN",
                <input
                  type="text"
                  value={form.pan}
                  onChange={(e) => setForm({ ...form, pan: e.target.value })}
                  className={`${inputCls} font-mono`}
                />,
              )}
              {field(
                "Industry Sector",
                <input
                  type="text"
                  value={form.industry}
                  onChange={(e) =>
                    setForm({ ...form, industry: e.target.value })
                  }
                  className={inputCls}
                />,
              )}
              {field(
                "Base Currency & Fiscal Year",
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={form.currency}
                    onChange={(e) =>
                      setForm({ ...form, currency: e.target.value })
                    }
                    className={inputCls}
                  >
                    <option value="INR (₹)">INR (₹)</option>
                    <option value="USD ($)">USD ($)</option>
                  </select>
                  <input
                    value={form.fiscalYear}
                    onChange={(e) =>
                      setForm({ ...form, fiscalYear: e.target.value })
                    }
                    className={inputCls}
                  />
                </div>,
              )}
              {field(
                "Registered Office Address",
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                  className={inputCls}
                />,
                "sm:col-span-2",
              )}
              {field(
                "PhonePe / UPI ID (receives subscription payments)",
                <input
                  type="text"
                  placeholder="yourname@ybl"
                  value={form.upiId || ""}
                  onChange={(e) =>
                    setForm({ ...form, upiId: e.target.value.trim() })
                  }
                  className={`${inputCls} font-mono`}
                />,
                "sm:col-span-2",
              )}
            </div>
            {saveBar}
          </div>
        )}

        {tab === "brand" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className={`${sectionCard} lg:col-span-3 space-y-6`}>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Brand & Theme
                </h3>
                <p className="text-xs text-slate-500">
                  Upload your logo and pick the sidebar colour.
                </p>
              </div>
              <div className="flex items-center gap-5 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                {form.logoDataUrl ? (
                  <img
                    src={form.logoDataUrl}
                    alt="Logo preview"
                    className="w-20 h-20 rounded-2xl object-cover border border-slate-300"
                  />
                ) : (
                  <div
                    className="w-20 h-20 rounded-2xl flex items-center justify-center text-white font-extrabold text-2xl shadow-md"
                    style={{ backgroundColor: form.accentColor || "#DC2626" }}
                  >
                    {monogram}
                  </div>
                )}
                <div className="space-y-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" /> Upload Logo
                    </button>
                    {form.logoDataUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          setForm((p) => ({ ...p, logoDataUrl: "" }))
                        }
                        className="px-3.5 py-2 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50"
                      >
                        Reset to Monogram
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    PNG or JPG, square image works best.
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Sidebar Theme Colour
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  {[
                    "#0A0A0B", "#1F2937", "#1E3A8A", "#0369A1", "#0F766E",
                    "#14532D", "#B45309", "#B91C1C", "#831843", "#4C1D95",
                  ].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() =>
                        setForm((p) => ({ ...p, primaryColor: c }))
                      }
                      className={`w-10 h-10 rounded-xl border-2 transition flex items-center justify-center ${form.primaryColor === c ? "border-blue-500 scale-110 shadow-md" : "border-transparent"}`}
                      style={{ backgroundColor: c }}
                    >
                      {form.primaryColor === c && (
                        <Check className="w-4 h-4 text-white" />
                      )}
                    </button>
                  ))}
                  <label
                    className="w-10 h-10 rounded-xl border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer overflow-hidden relative"
                    title="Pick any custom colour"
                  >
                    <span className="text-slate-500 text-lg font-bold">+</span>
                    <input
                      type="color"
                      value={form.primaryColor || "#0A0A0B"}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, primaryColor: e.target.value }))
                      }
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                  </label>
                </div>
              </div>
              {saveBar}
            </div>

            <div className={`${sectionCard} lg:col-span-2`}>
              <div className="text-xs font-bold uppercase text-slate-500 mb-3">
                Live Sidebar Preview
              </div>
              <div
                className="rounded-2xl p-4 space-y-3 text-white shadow-inner"
                style={{ backgroundColor: form.primaryColor || "#0A0A0B" }}
              >
                <div className="flex items-center gap-2.5">
                  {form.logoDataUrl ? (
                    <img
                      src={form.logoDataUrl}
                      alt=""
                      className="w-9 h-9 rounded-xl object-cover"
                    />
                  ) : (
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-extrabold"
                      style={{ backgroundColor: form.accentColor || "#DC2626" }}
                    >
                      {monogram}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">
                      {form.name}
                    </div>
                    <div className="text-[10px] text-slate-300 truncate">
                      {form.tagline || "Auron CommissionOS"}
                    </div>
                  </div>
                </div>
                {[
                  "Organisation Settings",
                  "Employees & Partners",
                  "Commission Engine",
                ].map((n, i) => (
                  <div
                    key={n}
                    className={`px-3 py-2 rounded-xl text-xs font-medium ${i === 0 ? "bg-blue-600 shadow-md" : "bg-white/5 text-slate-200"}`}
                  >
                    {n}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "rules" && (
          <div className={sectionCard}>
            <h3 className="text-base font-bold text-slate-900">
              Commission Calculation & Governance
            </h3>
            <p className="text-xs text-slate-500 mb-5">
              Defaults used by the engine, statements and approvals.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {field(
                "Calculation Frequency",
                <select
                  value={form.calcFrequency}
                  onChange={(e) =>
                    setForm({ ...form, calcFrequency: e.target.value })
                  }
                  className={inputCls}
                >
                  <option>Monthly</option>
                  <option>Quarterly</option>
                  <option>Bi-Weekly</option>
                </select>,
              )}
              {field(
                "Default TDS Withholding (%)",
                <input
                  type="number"
                  value={form.tdsRate}
                  onChange={(e) =>
                    setForm({ ...form, tdsRate: Number(e.target.value) })
                  }
                  className={inputCls}
                />,
              )}
              {field(
                "Rounding Rule",
                <select
                  value={form.roundingRule}
                  onChange={(e) =>
                    setForm({ ...form, roundingRule: e.target.value })
                  }
                  className={inputCls}
                >
                  <option>Nearest Rupee</option>
                  <option>2 Decimal Places</option>
                  <option>Round Down</option>
                </select>,
              )}
              {field(
                "Clawback Window (Days)",
                <input
                  type="number"
                  value={form.clawbackDays}
                  onChange={(e) =>
                    setForm({ ...form, clawbackDays: Number(e.target.value) })
                  }
                  className={inputCls}
                />,
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
              {[
                {
                  key: "autoHoldOnDispute",
                  title: "Auto-Hold on Open Dispute",
                  desc: "Pause payout of a statement while a dispute is open.",
                },
                {
                  key: "autoLockOnApproval",
                  title: "Auto-Lock Approved Statements",
                  desc: "Block direct edits once a statement is approved.",
                },
              ].map((t) => (
                <label
                  key={t.key}
                  className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100/70 transition"
                >
                  <input
                    type="checkbox"
                    checked={!!form[t.key]}
                    onChange={(e) =>
                      setForm({ ...form, [t.key]: e.target.checked })
                    }
                    className="w-4 h-4 mt-0.5 rounded text-blue-600"
                  />
                  <span>
                    <span className="block text-xs font-bold text-slate-900">
                      {t.title}
                    </span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      {t.desc}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {saveBar}
          </div>
        )}
      </form>

      {tab === "teams" && (
        <div className={`${sectionCard} space-y-5`}>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Departments & Sales Teams
            </h3>
            <p className="text-xs text-slate-500">
              Create teams and see their lead, size and quota.
            </p>
          </div>
          <form
            onSubmit={handleAddDept}
            className="grid grid-cols-1 sm:grid-cols-5 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200"
          >
            <input
              type="text"
              placeholder="Department / Team"
              value={newDept.name}
              onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
              className={inputCls}
            />
            <input
              type="text"
              placeholder="Team Lead"
              value={newDept.head}
              onChange={(e) => setNewDept({ ...newDept, head: e.target.value })}
              className={inputCls}
            />
            <input
              type="number"
              min="1"
              placeholder="Team Size"
              value={newDept.members}
              onChange={(e) =>
                setNewDept({ ...newDept, members: e.target.value })
              }
              className={inputCls}
            />
            <input
              type="text"
              placeholder="Quota e.g. ₹10,00,000"
              value={newDept.budgetTarget}
              onChange={(e) =>
                setNewDept({ ...newDept, budgetTarget: e.target.value })
              }
              className={inputCls}
            />
            <button
              type="submit"
              className="rounded-xl bg-[#0A0A0B] hover:bg-blue-900 text-white text-xs font-bold px-3 py-2.5 whitespace-nowrap"
            >
              + Add Team
            </button>
          </form>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {departments.map((d) => (
              <div
                key={d.id}
                className="rounded-2xl border border-slate-200 p-4 flex items-start gap-3 hover:shadow-md transition"
              >
                <div className="w-11 h-11 rounded-xl bg-blue-600 text-white font-extrabold text-sm flex items-center justify-center shrink-0">
                  {initialsOf(d.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-900 truncate">
                    {d.name}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Lead: {d.head}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[11px] font-semibold text-slate-700 whitespace-nowrap">
                      {d.members} Members
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-[11px] font-semibold text-emerald-700 whitespace-nowrap">
                      Quota {d.budgetTarget}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "users" && (
        <div className={`${sectionCard} space-y-5`}>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Users & Role Invitations
            </h3>
            <p className="text-xs text-slate-500">
              Invite teammates and assign their role.
            </p>
          </div>
          <form
            onSubmit={handleInviteUser}
            className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200"
          >
            <input
              type="email"
              required
              placeholder="user@company.in"
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              className={`${inputCls} sm:col-span-2`}
            />
            <select
              value={invite.role}
              onChange={(e) => setInvite({ ...invite, role: e.target.value })}
              className={inputCls}
            >
              <option>Admin / Owner</option>
              <option>Finance Manager</option>
              <option>Sales Manager</option>
              <option>Salesperson</option>
              <option>Referral Partner</option>
            </select>
            <button
              type="submit"
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-2.5 whitespace-nowrap flex items-center justify-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" /> Send Invite
            </button>
          </form>
          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 overflow-hidden">
            {users.map((u) => (
              <div
                key={u.id}
                className="p-3.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-slate-800 text-white font-bold text-[11px] flex items-center justify-center shrink-0">
                    {initialsOf(u.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 truncate">
                      {u.name}
                    </div>
                    <div className="text-slate-500 truncate">
                      {u.email} · {u.role} · {u.department}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {u.status === "Invited" && (
                    <>
                      <button
                        type="button"
                        onClick={() => openInviteMail(u)}
                        className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-bold hover:bg-blue-100 flex items-center gap-1 whitespace-nowrap"
                      >
                        <Mail className="w-3 h-3" /> Resend
                      </button>
                      <button
                        type="button"
                        onClick={() => copyInviteLink(u)}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 flex items-center gap-1 whitespace-nowrap"
                      >
                        <Copy className="w-3 h-3" /> Copy link
                      </button>
                    </>
                  )}
                  <span
                    className={`px-2.5 py-0.5 rounded-full font-semibold whitespace-nowrap ${u.status === "Active" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                  >
                    {u.status === "Invited" ? "Pending" : u.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "data" && <DataBackupCard notify={notify} />}

      {tab === "permissions" && (
        <div className={sectionCard}>
          <div className="mb-4">
            <h3 className="text-base font-bold text-slate-900">
              Granular Role & Permission Matrix
            </h3>
            <p className="text-xs text-slate-500">
              Click any cell to toggle module permissions per role.
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[11px]">
                  <th className="py-3 px-4 whitespace-nowrap">Role</th>
                  {[
                    "Org Settings",
                    "Billing",
                    "Policies",
                    "Transactions",
                    "Run Engine",
                    "Approve",
                    "Payouts",
                    "Reports",
                  ].map((h) => (
                    <th
                      key={h}
                      className="py-3 px-3 text-center whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rolePermissions.map((rp, rIdx) => (
                  <tr key={rp.role} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-slate-900 whitespace-nowrap">
                      {rp.role}
                    </td>
                    {[
                      "orgSettings",
                      "billing",
                      "policies",
                      "transactions",
                      "calculate",
                      "approve",
                      "payouts",
                      "reports",
                    ].map((perm) => (
                      <td key={perm} className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => togglePermissionCell(rIdx, perm)}
                          className="p-1 rounded-lg hover:bg-slate-200/70 transition"
                        >
                          {rp[perm] ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 inline" />
                          ) : (
                            <X className="w-4 h-4 text-slate-300 inline" />
                          )}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Minimal QR code generator (byte mode, ECC level M, versions 1-10) ----
function generateQrMatrix(text) {
  const utf8 = Array.from(unescape(encodeURIComponent(text)), (c) =>
    c.charCodeAt(0),
  );
  const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const NUM_BLOCKS = [1, 1, 2, 2, 4, 4, 4, 4, 5, 5];
  const rawModules = (v) => {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  };
  let ver = 0;
  for (let v = 1; v <= 10; v++) {
    const cap =
      Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v - 1] * NUM_BLOCKS[v - 1];
    const need = 4 + (v < 10 ? 8 : 16) + utf8.length * 8;
    if (need <= cap * 8) {
      ver = v;
      break;
    }
  }
  if (!ver) throw new Error("QR text too long");
  const size = ver * 4 + 17;
  const dataCap =
    Math.floor(rawModules(ver) / 8) -
    ECC_PER_BLOCK[ver - 1] * NUM_BLOCKS[ver - 1];

  // data bits
  const bits = [];
  const put = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(4, 4);
  put(utf8.length, ver < 10 ? 8 : 16);
  utf8.forEach((b) => put(b, 8));
  put(0, Math.min(4, dataCap * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < dataCap * 8; pad ^= 0xec ^ 0x11)
    put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }

  // Reed-Solomon
  const gfMul = (x, y) => {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  };
  const rsDivisor = (deg) => {
    const res = new Array(deg).fill(0);
    res[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < deg; j++) {
        res[j] = gfMul(res[j], root);
        if (j + 1 < deg) res[j] ^= res[j + 1];
      }
      root = gfMul(root, 2);
    }
    return res;
  };
  const rsRemainder = (d, div) => {
    const res = new Array(div.length).fill(0);
    d.forEach((b) => {
      const f = b ^ res.shift();
      res.push(0);
      div.forEach((c, i) => {
        res[i] ^= gfMul(c, f);
      });
    });
    return res;
  };
  const nb = NUM_BLOCKS[ver - 1],
    eb = ECC_PER_BLOCK[ver - 1];
  const rawCw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = nb - (rawCw % nb),
    shortLen = Math.floor(rawCw / nb);
  const blocks = [];
  const div = rsDivisor(eb);
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - eb + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < shortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const all = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((blk, j) => {
      if (i !== shortLen - eb || j >= shortBlocks) all.push(blk[i]);
    });

  // modules
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, v) => {
    mod[y][x] = v;
    fn[y][x] = true;
  };
  const bit = (x, i) => ((x >>> i) & 1) !== 0;
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  const finder = (x, y) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)),
          xx = x + dx,
          yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size)
          setFn(xx, yy, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const na = ver === 1 ? 0 : Math.floor(ver / 7) + 2;
  const pos = [];
  if (na) {
    const step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
    pos.push(6);
    for (let p = size - 7, c = na - 1; c > 0; p -= step, c--)
      pos.splice(1, 0, p);
  }
  pos.forEach((px, i) =>
    pos.forEach((py, j) => {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === na - 1) ||
        (i === na - 1 && j === 0)
      )
        return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          setFn(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const drawFormat = (mask) => {
    const d = (0 << 3) | mask; // ECC M = 0
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(b, i));
    setFn(8, 7, bit(b, 6));
    setFn(8, 8, bit(b, 7));
    setFn(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(b, i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3),
        c = Math.floor(i / 3);
      setFn(a, c, bit(b, i));
      setFn(c, a, bit(b, i));
    }
  }
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j,
          up = ((right + 1) & 2) === 0,
          y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && k < all.length * 8) {
          mod[y][x] = bit(all[k >>> 3], 7 - (k & 7));
          k++;
        }
      }
  }
  const applyMask = (m) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const inv = [
          (x + y) % 2 === 0,
          y % 2 === 0,
          x % 3 === 0,
          (x + y) % 3 === 0,
          (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
          ((x * y) % 2) + ((x * y) % 3) === 0,
          (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
          (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
        ][m];
        if (!fn[y][x] && inv) mod[y][x] = !mod[y][x];
      }
  };
  const penalty = () => {
    let p = 0;
    const lines = [];
    for (let y = 0; y < size; y++)
      lines.push(mod[y].map((v) => (v ? 1 : 0)).join(""));
    for (let x = 0; x < size; x++)
      lines.push(mod.map((r) => (r[x] ? 1 : 0)).join(""));
    lines.forEach((l) => {
      (l.match(/0{5,}|1{5,}/g) || []).forEach((r) => {
        p += r.length - 2;
      });
      (l.match(/(?=(10111010000|00001011101))/g) || []).forEach(() => {
        p += 40;
      });
    });
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++) {
        const c = mod[y][x];
        if (
          c === mod[y][x + 1] &&
          c === mod[y + 1][x] &&
          c === mod[y + 1][x + 1]
        )
          p += 3;
      }
    const dark = mod.reduce((s, r) => s + r.filter(Boolean).length, 0);
    p +=
      (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) *
      10;
    return p;
  };
  let best = 0,
    bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const p = penalty();
    if (p < bestP) {
      bestP = p;
      best = m;
    }
    applyMask(m);
  }
  applyMask(best);
  drawFormat(best);
  return mod;
}

// ---- Payment config: replace with your real PhonePe / UPI merchant ID ----
const PAYMENT_UPI_ID = "alphaauron@ybl";
const PAYMENT_PAYEE_NAME = "Alpha Auron";

// ---- Support contact ----
const SUPPORT_CONTACT = {
  name: "Poojitha",
  email: "poojitha@alphaauron.com",
  phone: "7207642479",
  phoneDisplay: "+91 72076 42479",
  hours: "9:30 AM – 6:30 PM",
  days: "Monday to Friday",
};

// contact details = defaults above, overridden by what the admin saved in the app (org.contact)
const getContact = (org) => {
  const saved = (org && org.contact) || {};
  const merged = { ...SUPPORT_CONTACT };
  Object.keys(saved).forEach((key) => {
    if (saved[key] !== undefined && saved[key] !== "") merged[key] = saved[key];
  });
  const digits = String(merged.phone || "")
    .replace(/\D/g, "")
    .slice(-10);
  return {
    ...merged,
    phone: digits,
    phoneDisplay:
      digits.length === 10
        ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
        : merged.phone,
  };
};

function QrCodeSvg({ value, size = 220 }) {
  const matrix = useMemo(() => {
    try {
      return generateQrMatrix(value);
    } catch (e) {
      return null;
    }
  }, [value]);
  if (!matrix)
    return <div className="text-xs text-rose-600">Unable to generate QR</div>;
  const n = matrix.length;
  const q = 4;
  let d = "";
  matrix.forEach((row, y) =>
    row.forEach((v, x) => {
      if (v) d += `M${x + q},${y + q}h1v1h-1z`;
    }),
  );
  return (
    <svg
      viewBox={`0 0 ${n + q * 2} ${n + q * 2}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
    >
      <rect width="100%" height="100%" fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

function CheckoutModal({
  plan,
  cycle,
  price,
  onClose,
  onPaid,
  defaultEmail,
  upiId,
}) {
  const payId = (upiId || "").trim();
  const upiMissing = !payId || payId === "alphaauron@ybl";
  const [step, setStep] = useState("login"); // login -> pay -> done
  const [mode, setMode] = useState("signin");
  const [auth, setAuth] = useState({
    name: "",
    email: defaultEmail || "",
    password: "",
  });
  const [authError, setAuthError] = useState("");
  const [utr, setUtr] = useState("");
  const [copied, setCopied] = useState(false);
  const [invoiceId, setInvoiceId] = useState("");

  const gst = Math.round(price * 0.18);
  const total = price + gst;
  const orderRef = useMemo(() => `AURON${Date.now().toString().slice(-8)}`, []);
  const upiQuery =
    `pa=${payId}&pn=${encodeURIComponent(PAYMENT_PAYEE_NAME)}` +
    `&am=${total.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Auron ${plan.name} plan`)}`;
  const upiLink = `upi://pay?${upiQuery}`;
  const phonePeLink = `phonepe://pay?${upiQuery}`;

  const handleAuth = async (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(auth.email))
      return setAuthError("Enter a valid email address.");
    if (auth.password.length < 6)
      return setAuthError("Password must be at least 6 characters.");
    setAuthError("");
    try {
      await api.post("/auth/confirm", {
        email: auth.email,
        password: auth.password,
      });
      setStep("pay");
    } catch (err) {
      setAuthError(err.message);
    }
    return undefined;
  };

  const utrValid = /^[0-9]{12}$/.test(utr.trim());

  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState("");
  const handleConfirm = async (e) => {
    e.preventDefault();
    if (!utrValid) return;
    setPayBusy(true);
    setPayError("");
    try {
      const id = await onPaid(utr.trim(), auth.email);
      setInvoiceId(id);
      setStep("done");
    } catch (err) {
      setPayError(err.message);
    }
    setPayBusy(false);
  };

  const copyUpi = () => {
    navigator.clipboard?.writeText(payId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden my-6">
        <div className="px-6 py-4 bg-gradient-to-r from-[#0A0A0B] to-[#5A1010] text-white flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-blue-200 font-semibold">
              Subscribe
            </div>
            <div className="text-lg font-extrabold">
              {plan.name} Plan ·{" "}
              {cycle === "annual" ? "Annual billing" : "Monthly billing"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-4 flex items-center gap-2 text-[11px] font-bold">
          {[
            ["login", "1. Login"],
            ["pay", "2. Pay with UPI"],
            ["done", "3. Done"],
          ].map(([id, label], i) => (
            <React.Fragment key={id}>
              <span
                className={`px-3 py-1 rounded-full ${step === id ? "bg-blue-600 text-white" : ["login", "pay", "done"].indexOf(step) > i ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}
              >
                {label}
              </span>
              {i < 2 && <span className="h-px flex-1 bg-slate-200" />}
            </React.Fragment>
          ))}
        </div>

        {step === "login" && (
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <form onSubmit={handleAuth} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-1 bg-slate-100 p-1 rounded-xl">
                {[["signin", "Confirm your login"]].map(([m, l]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`py-2 rounded-lg font-bold ${mode === m ? "bg-white shadow-xs text-slate-900" : "text-slate-500"}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {mode === "register" && (
                <div>
                  <label className="font-semibold block mb-1">Full Name</label>
                  <input
                    value={auth.name}
                    onChange={(e) => setAuth({ ...auth, name: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5"
                    placeholder="Your name"
                  />
                </div>
              )}
              <div>
                <label className="font-semibold block mb-1">Email</label>
                <input
                  type="email"
                  value={auth.email}
                  onChange={(e) => setAuth({ ...auth, email: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5"
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Password</label>
                <input
                  type="password"
                  value={auth.password}
                  onChange={(e) =>
                    setAuth({ ...auth, password: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5"
                  placeholder="Minimum 6 characters"
                />
              </div>
              {authError && (
                <div className="text-rose-600 font-semibold">{authError}</div>
              )}
              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center justify-center gap-2"
              >
                <LogIn className="w-4 h-4" />{" "}
                {mode === "signin"
                  ? "Login & Continue"
                  : "Create Account & Continue"}
              </button>
              <p className="text-[11px] text-slate-500">
                Login is required to book a plan so the invoice is issued to
                your account.
              </p>
            </form>
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5 text-xs space-y-3 self-start">
              <div className="text-sm font-bold text-slate-900">
                Order Summary
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">
                  {plan.name} Plan (
                  {cycle === "annual" ? "12 months" : "1 month"})
                </span>
                <strong>{formatINR(price)}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">GST (18%)</span>
                <strong>{formatINR(gst)}</strong>
              </div>
              <div className="flex justify-between pt-3 border-t border-slate-200 text-base font-extrabold text-slate-900">
                <span>Total payable</span>
                <span>{formatINR(total)}</span>
              </div>
            </div>
          </div>
        )}

        {step === "pay" && (
          <form
            onSubmit={handleConfirm}
            className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs"
          >
            <div className="rounded-2xl border border-slate-200 overflow-hidden self-start">
              <div
                className="px-4 py-3 text-white font-bold flex items-center justify-between"
                style={{ backgroundColor: "#5F259F" }}
              >
                <span className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4" /> PhonePe / UPI
                </span>
                <span className="text-[11px] font-semibold opacity-90">
                  Scan & Pay
                </span>
              </div>
              <div className="p-5 flex flex-col items-center gap-3 bg-white">
                <div className="p-2 rounded-2xl border-2 border-violet-200">
                  <QrCodeSvg value={upiLink} size={210} />
                </div>
                <div className="text-2xl font-extrabold text-slate-900">
                  {formatINR(total)}
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <span className="font-mono font-semibold">
                    {payId || "UPI ID not set"}
                  </span>
                  <button
                    type="button"
                    onClick={copyUpi}
                    className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                {upiMissing && (
                  <div className="w-full rounded-xl bg-amber-50 border border-amber-300 text-amber-900 p-3 text-[11px] leading-snug">
                    <strong>UPI ID not set.</strong> This QR uses a placeholder
                    ID, so the payment app will show an error. Add your real
                    PhonePe / UPI ID in Organisation Settings → Company Profile.
                  </div>
                )}
                <div className="w-full grid grid-cols-2 gap-2">
                  <a
                    href={phonePeLink}
                    className="text-center py-2.5 rounded-xl text-white font-bold"
                    style={{ backgroundColor: "#5F259F" }}
                  >
                    Open PhonePe
                  </a>
                  <a
                    href={upiLink}
                    className="text-center py-2.5 rounded-xl bg-slate-900 text-white font-bold"
                  >
                    Any UPI app
                  </a>
                </div>
                <p className="text-[11px] text-slate-500 text-center">
                  Open PhonePe, Google Pay or any UPI app → Scan QR → pay the
                  exact amount.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
                <div className="text-sm font-bold text-slate-900">
                  Order Summary
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">
                    {plan.name} Plan (
                    {cycle === "annual" ? "12 months" : "1 month"})
                  </span>
                  <strong>{formatINR(price)}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">GST (18%)</span>
                  <strong>{formatINR(gst)}</strong>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200 font-extrabold text-slate-900">
                  <span>Total</span>
                  <span>{formatINR(total)}</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Order ref: {orderRef} · Billed to {auth.email}
                </div>
              </div>
              <div>
                <label className="font-semibold block mb-1">
                  After paying, enter 12-digit UTR / Transaction ID
                </label>
                <input
                  value={utr}
                  onChange={(e) =>
                    setUtr(e.target.value.replace(/\D/g, "").slice(0, 12))
                  }
                  inputMode="numeric"
                  placeholder="e.g. 412345678901"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono tracking-wider"
                />
                <div className="text-[11px] text-slate-500 mt-1">
                  Find it in PhonePe → History → payment details.
                </div>
              </div>
              {payError && (
                <div className="text-rose-600 font-semibold">{payError}</div>
              )}
              <button
                type="submit"
                disabled={!utrValid || payBusy}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold"
              >
                {payBusy ? "Verifying…" : "I have paid — Confirm Subscription"}
              </button>
              <button
                type="button"
                onClick={() => setStep("login")}
                className="w-full py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
              >
                ← Back
              </button>
            </div>
          </form>
        )}

        {step === "done" && (
          <div className="p-10 text-center space-y-3">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9 text-emerald-600" />
            </div>
            <h3 className="text-xl font-extrabold text-slate-900">
              Payment recorded — {plan.name} Plan active
            </h3>
            <p className="text-xs text-slate-600">
              Invoice <strong>{invoiceId}</strong> for {formatINR(total)} has
              been added to your billing history.
            </p>
            <button
              onClick={onClose}
              className="mt-3 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentQrCard({ org, setOrg, isAdmin, notify }) {
  const fileRef = useRef(null);
  const qr = org.paymentQrDataUrl || "";
  const onFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\//.test(file.type))
      return notify("Please choose an image file (PNG or JPG).", "error");
    if (file.size > 1.5 * 1024 * 1024)
      return notify("QR image is too large. Keep it under 1.5 MB.", "error");
    const reader = new FileReader();
    reader.onload = () => {
      setOrg((prev) => ({ ...prev, paymentQrDataUrl: reader.result }));
      notify(
        "Payment QR code uploaded. It now shows on the subscription page.",
      );
    };
    reader.readAsDataURL(file);
    return undefined;
  };
  if (!isAdmin && !qr) return null;
  return (
    <div
      data-allow="all"
      className="bg-white rounded-2xl border border-red-900/40 shadow-xs overflow-hidden"
    >
      <div className="px-6 py-4 bg-gradient-to-r from-[#0A0A0B] to-[#7F1D1D] text-white flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-red-200">
            Subscription payment
          </div>
          <h3 className="text-base font-extrabold">Scan the QR code to pay</h3>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current && fileRef.current.click()}
              className="px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />{" "}
              {qr ? "Replace QR code" : "Upload QR code"}
            </button>
            {qr && (
              <button
                type="button"
                onClick={() => {
                  setOrg((prev) => ({ ...prev, paymentQrDataUrl: "" }));
                  notify("Payment QR code removed.");
                }}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
      <div className="p-6 flex flex-wrap items-center gap-6">
        {qr ? (
          <img
            src={qr}
            alt="Subscription payment QR code"
            className="w-36 h-36 rounded-2xl bg-white p-2 border-2 border-red-600 object-contain"
          />
        ) : (
          <div className="w-36 h-36 rounded-2xl border-2 border-dashed border-red-900/50 flex flex-col items-center justify-center gap-2 text-center text-xs text-slate-500 p-4">
            <QrCode className="w-9 h-9 text-red-500" />
            No QR code uploaded yet. Upload your PhonePe / UPI QR image.
          </div>
        )}
        <div className="text-xs text-slate-600 space-y-2 max-w-md">
          <p className="text-sm font-bold text-slate-900">How to pay</p>
          <p>1. Open PhonePe, Google Pay, Paytm or any UPI app.</p>
          <p>
            2. Scan this QR code and pay the exact plan amount (including 18%
            GST).
          </p>
          <p>
            3. Keep the payment reference. Your receipt is e-mailed once the
            subscription is active.
          </p>
        </div>
      </div>
    </div>
  );
}

function ContactSupportCard({
  org,
  setOrg,
  canEdit = false,
  notify,
  defaultName = "",
  defaultEmail = "",
}) {
  const contact = getContact(org);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const openEdit = () => {
    setDraft({
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      hours: contact.hours,
      days: contact.days,
    });
    setEditing(true);
  };
  const saveContact = (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(draft.email || ""))
      return notify("Enter a valid contact email.", "error");
    if (String(draft.phone || "").replace(/\D/g, "").length < 10)
      return notify("Enter a valid 10-digit phone number.", "error");
    setOrg((prev) => ({ ...prev, contact: { ...draft } }));
    setEditing(false);
    notify("Contact details updated.");
    return undefined;
  };
  const blank = {
    name: defaultName,
    email: defaultEmail,
    phone: "",
    topic: "Billing & Subscription",
    message: "",
  };
  const [f, setF] = useState(blank);
  const [sending, setSending] = useState(false);
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const isOpen =
    now.getDay() >= 1 && now.getDay() <= 5 && mins >= 570 && mins < 1110;
  const waText = encodeURIComponent(
    `Hi ${contact.name}, I have a query about Auron CommissionOS.`,
  );
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(org.address)}`;

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const r = await api.post("/contact", {
        name: f.name,
        email: f.email,
        phone: f.phone,
        topic: f.topic,
        message: f.message,
      });
      notify(
        r.emailed
          ? "Message sent. Our team has been e-mailed and will reply to you soon."
          : "Message sent. Our team will see it in the support inbox and reply to you soon.",
      );
      setF({ ...blank, topic: f.topic });
    } catch (err) {
      notify(
        err.message || "Could not send your message. Please try again.",
        "error",
      );
    }
    setSending(false);
  };

  const ic =
    "w-11 h-11 rounded-full flex items-center justify-center text-white shadow-sm hover:scale-105 transition";
  const input =
    "w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none";

  return (
    <div
      id="contact-support"
      data-allow="all"
      className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900">
            Contact Us — Any Query?
          </h3>
          <p className="text-xs text-slate-500">
            Reach us by email, call or WhatsApp, or send the form below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={openEdit}
              className="px-3 py-1 rounded-full bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold flex items-center gap-1.5"
            >
              <Edit3 className="w-3 h-3" /> Edit contact details
            </button>
          )}
          <span
            className={`px-3 py-1 rounded-full text-[11px] font-bold ${isOpen ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}
          >
            {isOpen ? "● Office open now" : "○ Office closed now"}
          </span>
        </div>
      </div>
      {canEdit && editing && (
        <form
          onSubmit={saveContact}
          className="px-6 py-4 border-b border-slate-100 bg-slate-50 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs"
        >
          {[
            ["name", "Contact person"],
            ["email", "Email"],
            ["phone", "Phone / WhatsApp (10 digits)"],
            ["hours", "Office hours"],
            ["days", "Available days"],
          ].map(([key, label]) => (
            <div key={key}>
              <label className="font-semibold block mb-1">{label}</label>
              <input
                value={draft[key] || ""}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs bg-white"
              />
            </div>
          ))}
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-5">
        <div className="lg:col-span-2 p-6 bg-slate-50 space-y-5 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#0A0A0B] text-white font-extrabold flex items-center justify-center">
              {String(contact.name || "S")
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">
                {contact.name}
              </div>
              <div className="text-slate-500">Customer Support</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`mailto:${contact.email}`}
              className={`${ic} bg-blue-600`}
              title="Send email"
            >
              <Mail className="w-5 h-5" />
            </a>
            <a
              href={`tel:+91${contact.phone}`}
              className={`${ic} bg-sky-600`}
              title="Call now"
            >
              <Phone className="w-5 h-5" />
            </a>
            <a
              href={`https://wa.me/91${contact.phone}?text=${waText}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${ic} bg-emerald-500`}
              title="Chat on WhatsApp"
            >
              <MessageCircle className="w-5 h-5" />
            </a>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${ic} bg-rose-500`}
              title="Open in Maps"
            >
              <MapPin className="w-5 h-5" />
            </a>
          </div>
          <div className="space-y-3">
            <a
              href={`mailto:${contact.email}`}
              className="flex items-start gap-3 hover:text-blue-700"
            >
              <Mail className="w-4 h-4 mt-0.5 text-blue-600 shrink-0" />
              <span>
                <span className="block text-[10px] uppercase font-bold text-slate-400">
                  Email
                </span>
                <span className="font-semibold text-slate-800 break-all">
                  {contact.email}
                </span>
              </span>
            </a>
            <a
              href={`tel:+91${contact.phone}`}
              className="flex items-start gap-3 hover:text-blue-700"
            >
              <Phone className="w-4 h-4 mt-0.5 text-sky-600 shrink-0" />
              <span>
                <span className="block text-[10px] uppercase font-bold text-slate-400">
                  Phone / WhatsApp
                </span>
                <span className="font-semibold text-slate-800">
                  {contact.phoneDisplay}
                </span>
              </span>
            </a>
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
              <span>
                <span className="block text-[10px] uppercase font-bold text-slate-400">
                  Office Hours
                </span>
                <span className="font-semibold text-slate-800">
                  {contact.hours}
                </span>
                <span className="block text-slate-500">
                  Available: {contact.days}
                </span>
              </span>
            </div>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 hover:text-blue-700"
            >
              <MapPin className="w-4 h-4 mt-0.5 text-rose-600 shrink-0" />
              <span>
                <span className="block text-[10px] uppercase font-bold text-slate-400">
                  Address
                </span>
                <span className="font-semibold text-slate-800">
                  {org.address}
                </span>
              </span>
            </a>
          </div>
        </div>
        <form
          onSubmit={submit}
          className="lg:col-span-3 p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs"
        >
          <div>
            <label className="font-semibold block mb-1">Your Name *</label>
            <input
              required
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              className={input}
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Email *</label>
            <input
              required
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
              className={input}
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Phone Number</label>
            <input
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
              className={input}
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">Topic</label>
            <select
              value={f.topic}
              onChange={(e) => setF({ ...f, topic: e.target.value })}
              className={input}
            >
              <option>Billing & Subscription</option>
              <option>Technical Support</option>
              <option>Product Demo</option>
              <option>Enterprise Pricing</option>
              <option>Other</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="font-semibold block mb-1">Your Query *</label>
            <textarea
              required
              rows={4}
              value={f.message}
              onChange={(e) => setF({ ...f, message: e.target.value })}
              className={input}
              placeholder="Tell us how we can help…"
            />
          </div>
          <div className="sm:col-span-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-500">
              We reply during office hours, {contact.days}.
            </span>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-2 whitespace-nowrap"
            >
              <Send className="w-4 h-4" /> Send Query
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// ADDITIONAL SECTION 3 & 14: SUBSCRIPTION & BILLING + SAAS SUBSCRIPTION PLANS
// ============================================================================
function ModuleSubscriptionBilling({
  org,
  subscription,
  setSubscription,
  billingInvoices,
  setBillingInvoices,
  usersCount,
  transactionsCount,
  policiesCount,
  onPaymentRecorded,
  currentUserEmail,
  currentUserName,
  accessLevel = "admin",
  setOrg = () => { },
  notify,
}) {
  const isAdmin = accessLevel === "admin";
  // admin: the saved billing cycle. view-only users can still pick monthly / annual before they pay (kept in the page only)
  const [localCycle, setLocalCycle] = useState("monthly");
  const cycle = isAdmin ? subscription.billingCycle : localCycle;
  const [enterpriseModal, setEnterpriseModal] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  const [enterpriseLead, setEnterpriseLead] = useState({
    contactName: "Arjun Mehta",
    workEmail: "owner@aurontech.in",
    teamSize: "250+ reps",
    notes:
      "Require SAP S/4HANA connector, custom multi-entity hierarchies, and SAML SSO.",
  });

  const currentPlan =
    SAAS_PLANS.find((p) => p.id === subscription.planId) || SAAS_PLANS[2];

  const handleToggleCycle = (next) => {
    if (isAdmin) setSubscription((prev) => ({ ...prev, billingCycle: next }));
    else setLocalCycle(next);
    notify(
      `Switched billing preview to ${next === "annual" ? "Annual (Save 20%)" : "Monthly"} cycle.`,
    );
  };

  const handleSelectPlan = (plan) => {
    setCheckoutPlan(plan);
  };

  // Enterprise is custom-priced: this is the default amount used for online checkout (edit as needed)
  const ENTERPRISE_PRICE = { monthly: 24999, annual: 19999 };
  const planPrice = (plan) => {
    const annual = cycle === "annual";
    const perMonth = annual
      ? (plan.annualMonthlyPrice ?? ENTERPRISE_PRICE.annual)
      : (plan.monthlyPrice ?? ENTERPRISE_PRICE.monthly);
    return annual ? perMonth * 12 : perMonth;
  };

  const handleEnterpriseQuote = (e) => {
    e.preventDefault();
    setEnterpriseModal(false);
    notify(
      "Enterprise custom pricing request submitted! Our Solutions Architect will reach out within 4 hours.",
    );
  };

  const userPct = Math.min(
    100,
    Math.round((usersCount / currentPlan.limits.users) * 100),
  );
  const txnPct =
    currentPlan.limits.transactions >= 999999
      ? 12
      : Math.min(
        100,
        Math.round(
          (transactionsCount / currentPlan.limits.transactions) * 100,
        ),
      );
  const polPct =
    currentPlan.limits.policies >= 999
      ? 18
      : Math.min(
        100,
        Math.round((policiesCount / currentPlan.limits.policies) * 100),
      );

  return (
    <div className="space-y-6">
      <FreeSubscriptionBanner refreshKey={billingInvoices.length} />
      {/* Specification Disclaimer Banner */}
      <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Info className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Section 14 Specification Note:</strong> Auron CommissionOS
            is a subscription-based SaaS product billed monthly or annually.{" "}
            <em>
              These are initial pricing hypotheses from the specification, not
              final approved prices.
            </em>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-lg bg-amber-200/70 font-bold text-amber-950">
            GST (18%) Exclusive
          </span>
        </div>
      </div>

      {/* Current Subscription Overview & Usage Quotas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Current Active Plan Summary */}
        <div className="bg-gradient-to-br from-[#0A0A0B] to-[#5A1010] text-white rounded-2xl p-6 shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[11px] font-bold">
                {subscription.status} Subscription
              </span>
              <Crown className="w-5 h-5 text-amber-300" />
            </div>
            <h2 className="text-2xl font-extrabold mt-3">
              {currentPlan.name} Plan
            </h2>
            <p className="text-xs text-blue-200 mt-1">
              Intended for: <strong>{currentPlan.intendedCustomer}</strong>
            </p>
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="text-3xl font-extrabold">
                {currentPlan.monthlyPrice === 0
                  ? "Free"
                  : currentPlan.monthlyPrice
                    ? formatINR(
                      subscription.billingCycle === "annual"
                        ? currentPlan.annualMonthlyPrice
                        : currentPlan.monthlyPrice,
                    )
                    : "Custom"}
                {currentPlan.monthlyPrice > 0 && (
                  <span className="text-xs font-normal text-blue-200">
                    {" "}
                    / month
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-300 mt-1">
                Billing Cycle:{" "}
                <strong className="capitalize">
                  {subscription.billingCycle}
                </strong>{" "}
                • Renewal: {subscription.nextBillingDate}
              </div>
            </div>
          </div>

          <div className="mt-6 pt-3 border-t border-white/10 text-xs flex items-center justify-between text-blue-100">
            <span>{subscription.paymentMethod}</span>
            <span className="font-semibold text-white">Auto-Renew ON</span>
          </div>
        </div>

        {/* Live Usage Limits & Quotas */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Workspace Usage Limits & Entitlements
              </h3>
              <p className="text-xs text-slate-500">
                Real-time consumption tracked against your {currentPlan.name}{" "}
                plan thresholds.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1 rounded-lg">
              Cycle: November 2026
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
            {/* Users Quota */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
              <div className="flex justify-between font-bold">
                <span className="text-slate-700">Active Platform Users</span>
                <span className="text-slate-900">
                  {usersCount} /{" "}
                  {currentPlan.limits.users >= 9999
                    ? "Unlimited"
                    : currentPlan.limits.users}
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full"
                  style={{ width: `${userPct}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500">
                Includes Admin, Finance, Managers & Reps
              </div>
            </div>

            {/* Transactions Quota */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
              <div className="flex justify-between font-bold">
                <span className="text-slate-700">
                  Monthly Sales Transactions
                </span>
                <span className="text-slate-900">
                  {transactionsCount} /{" "}
                  {currentPlan.limits.transactions >= 999999
                    ? "Unlimited"
                    : currentPlan.limits.transactions.toLocaleString("en-IN")}
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-600 rounded-full"
                  style={{ width: `${txnPct}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500">
                Manual, CSV & Excel imported invoices
              </div>
            </div>

            {/* Active Commission Policies */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
              <div className="flex justify-between font-bold">
                <span className="text-slate-700">
                  Active Commission Policies
                </span>
                <span className="text-slate-900">
                  {policiesCount} /{" "}
                  {currentPlan.limits.policies >= 999
                    ? "Unlimited"
                    : currentPlan.limits.policies}
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 rounded-full"
                  style={{ width: `${polPct}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500">
                All 7 incentive models unlocked
              </div>
            </div>

            {/* Document & Audit Vault Storage */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
              <div className="flex justify-between font-bold">
                <span className="text-slate-700">Audit & Statement Vault</span>
                <span className="text-slate-900">
                  1.8 GB / {currentPlan.limits.storageGB} GB
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full"
                  style={{ width: "14%" }}
                />
              </div>
              <div className="text-[11px] text-slate-500">
                PDF statements, dispute attachments & bank feeds
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 14: Subscription Plans Comparison Matrix */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              Auron CommissionOS SaaS Subscription Plans
            </h3>
            <p className="text-xs text-slate-500">
              Select a monthly or annual subscription plan tailored to your
              sales team size.
            </p>
          </div>

          {/* Monthly vs Annual Billing Toggle */}
          <div
            data-allow="all"
            className="inline-flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold"
          >
            <button
              type="button"
              onClick={() => handleToggleCycle("monthly")}
              className={`px-4 py-2 rounded-lg transition ${cycle === "monthly"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600"
                }`}
            >
              Monthly Billing
            </button>
            <button
              type="button"
              onClick={() => handleToggleCycle("annual")}
              className={`px-4 py-2 rounded-lg transition flex items-center gap-1.5 ${cycle === "annual"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-600"
                }`}
            >
              Annual Billing
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${cycle === "annual"
                  ? "bg-white/20 text-white"
                  : "bg-emerald-100 text-emerald-800"
                  }`}
              >
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* 4 Plan Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
          {SAAS_PLANS.map((plan) => {
            const isCurrent = subscription.planId === plan.id;
            const displayPrice =
              cycle === "annual" ? plan.annualMonthlyPrice : plan.monthlyPrice;

            return (
              <div
                key={plan.id}
                className={`rounded-2xl border p-5 flex flex-col justify-between transition-all ${isCurrent
                  ? "border-blue-600 ring-2 ring-blue-600/20 bg-blue-50/30"
                  : plan.popular
                    ? "border-slate-300 shadow-sm bg-white"
                    : "border-slate-200 bg-white"
                  }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span
                      className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${plan.popular
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700"
                        }`}
                    >
                      {plan.badge}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500">
                      {plan.intendedCustomer}
                    </span>
                  </div>

                  <h4 className="text-lg font-extrabold text-slate-900">
                    {plan.name}
                  </h4>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                      {displayPrice === 0
                        ? "Free"
                        : displayPrice
                          ? formatINR(displayPrice)
                          : "Custom"}
                    </span>
                    {displayPrice > 0 && (
                      <span className="text-xs text-slate-500 font-medium">
                        / month
                      </span>
                    )}
                  </div>
                  {displayPrice > 0 && cycle === "annual" && (
                    <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                      Billed annually ({formatINR(displayPrice * 12)}/yr)
                    </div>
                  )}

                  <p className="text-xs text-slate-600 mt-3 leading-relaxed">
                    {plan.description}
                  </p>

                  <ul className="mt-4 pt-4 border-t border-slate-100 space-y-2 text-xs text-slate-700">
                    {plan.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 pt-3">
                  <button
                    type="button"
                    onClick={() => handleSelectPlan(plan)}
                    className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition ${isCurrent
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : plan.id === "enterprise"
                        ? "bg-[#0A0A0B] hover:bg-blue-900 text-white"
                        : "bg-blue-600 hover:bg-blue-700 text-white"
                      }`}
                  >
                    Subscribe to {plan.name}
                    {isCurrent ? " (Current Plan ✓)" : ""}
                  </button>
                  {plan.id === "enterprise" && (
                    <button
                      type="button"
                      onClick={() => setEnterpriseModal(true)}
                      className="w-full mt-2 text-[11px] font-semibold text-blue-700 hover:text-blue-900"
                    >
                      Need custom pricing? Request a quote →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <PaymentQrCard
        org={org}
        setOrg={setOrg}
        isAdmin={isAdmin}
        notify={notify}
      />

      {/* Payments summary (admin sees everybody's payments, a user only their own) */}
      {(() => {
        const paid = billingInvoices.filter((i) => Number(i.total) > 0);
        const collected = paid.reduce((s, i) => s + (Number(i.total) || 0), 0);
        const latest = billingInvoices[0];
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              [
                isAdmin ? "Total Collected" : "Total Paid",
                formatINR(collected),
                "text-red-700 bg-red-50",
              ],
              ["Paid Invoices", paid.length, "text-slate-900 bg-white"],
              [
                "Free Activations",
                billingInvoices.filter((i) => i.source === "free").length,
                "text-emerald-700 bg-emerald-50",
              ],
              [
                "Latest Payer",
                latest ? latest.payerName || "—" : "—",
                "text-slate-900 bg-white",
              ],
            ].map(([l, v, c]) => (
              <div
                key={l}
                className={`rounded-2xl border border-slate-200 p-4 ${c.split(" ")[1]}`}
              >
                <div className="text-[11px] font-semibold uppercase text-slate-500">
                  {l}
                </div>
                <div
                  className={`text-xl font-extrabold mt-1 truncate ${c.split(" ")[0]}`}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Billing History & GST Tax Invoices Table */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {isAdmin
                ? "Payments Received & GST Invoices"
                : "My Payments & GST Invoices"}
            </h3>
            <p className="text-xs text-slate-500">
              GSTIN on file:{" "}
              <span className="font-mono font-semibold">{org.gstin}</span> •
              Billing Contact: {subscription.billingEmail}
            </p>
          </div>
          <button
            onClick={() => {
              downloadCSV(
                "Auron_CommissionOS_SaaS_Invoices.csv",
                [
                  "Invoice ID",
                  "Date",
                  "Subscription Plan",
                  "Subtotal (INR)",
                  "GST 18%",
                  "Total Paid",
                  "Paid By",
                  "Payer Email",
                  "Razorpay Payment ID",
                  "Status",
                ],
                billingInvoices.map((inv) => [
                  inv.id,
                  inv.date,
                  inv.plan,
                  inv.subtotal,
                  inv.gst,
                  inv.total,
                  inv.payerName || "",
                  inv.payerEmail || "",
                  inv.razorpayPaymentId || "",
                  inv.status,
                ]),
              );
              notify("Exported SaaS billing invoices CSV.");
            }}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Export Billing Ledger
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                <th className="py-3 px-3">Invoice #</th>
                <th className="py-3 px-3">Billing Date</th>
                <th className="py-3 px-3">Subscription Plan</th>
                <th className="py-3 px-3 text-right">Base Amount</th>
                <th className="py-3 px-3 text-right">GST (18%)</th>
                <th className="py-3 px-3 text-right">Total Paid</th>
                <th className="py-3 px-3">Payment Method</th>
                <th className="py-3 px-3">Paid By</th>
                <th className="py-3 px-3">Razorpay Payment ID</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-center">Invoice PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {billingInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-3 font-bold text-blue-700">
                    {inv.id}
                  </td>
                  <td className="py-3 px-3 text-slate-600">{inv.date}</td>
                  <td className="py-3 px-3 font-semibold text-slate-900">
                    {inv.plan}
                  </td>
                  <td className="py-3 px-3 text-right">
                    {formatINR(inv.subtotal)}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-500">
                    {formatINR(inv.gst)}
                  </td>
                  <td className="py-3 px-3 text-right font-extrabold text-slate-900">
                    {formatINR(inv.total)}
                  </td>
                  <td className="py-3 px-3 text-slate-600">{inv.method}</td>
                  <td className="py-3 px-3">
                    <div className="font-semibold text-slate-900">
                      {inv.payerName || "—"}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {inv.payerEmail || ""}
                    </div>
                  </td>
                  <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                    {inv.razorpayPaymentId ||
                      (inv.source === "free" ? "Free first subscription" : "—")}
                  </td>
                  <td className="py-3 px-3">
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                      {inv.status}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        downloadPdf(
                          `${inv.id}.pdf`,
                          (logo) =>
                            subscriptionInvoiceOps(
                              inv,
                              org,
                              logo,
                              getContact(org),
                            ),
                          org,
                        );
                        notify(`Invoice ${inv.id} downloaded as PDF.`);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" /> PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        downloadPdf(
                          `Receipt-${inv.id}.pdf`,
                          (logo) =>
                            subscriptionReceiptOps(
                              inv,
                              org,
                              logo,
                              getContact(org),
                            ),
                          org,
                        );
                        notify(`Receipt for ${inv.id} downloaded as PDF.`);
                      }}
                      className="ml-2 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Receipt className="w-3.5 h-3.5" /> Receipt PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {checkoutPlan && (
        <PlanCheckout
          plan={checkoutPlan}
          cycle={cycle === "annual" ? "annual" : "monthly"}
          defaultEmail={currentUserEmail}
          defaultName={currentUserName}
          adminQr={org.paymentQrDataUrl || ""}
          onClose={() => setCheckoutPlan(null)}
          onPaid={onPaymentRecorded}
          notify={notify}
        />
      )}

      {/* Enterprise Custom Quote Modal */}
      {enterpriseModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleEnterpriseQuote}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 text-xs shadow-2xl"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Enterprise Plan — Custom Pricing Request
              </h3>
              <button type="button" onClick={() => setEnterpriseModal(false)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="font-bold block mb-1">Contact Name</label>
                <input
                  required
                  value={enterpriseLead.contactName}
                  onChange={(e) =>
                    setEnterpriseLead({
                      ...enterpriseLead,
                      contactName: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-bold block mb-1">Work Email</label>
                <input
                  type="email"
                  required
                  value={enterpriseLead.workEmail}
                  onChange={(e) =>
                    setEnterpriseLead({
                      ...enterpriseLead,
                      workEmail: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-bold block mb-1">
                  Estimated Sales & Finance Headcount
                </label>
                <input
                  value={enterpriseLead.teamSize}
                  onChange={(e) =>
                    setEnterpriseLead({
                      ...enterpriseLead,
                      teamSize: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-bold block mb-1">
                  ERP / CRM Integration & SLA Requirements
                </label>
                <textarea
                  rows={3}
                  value={enterpriseLead.notes}
                  onChange={(e) =>
                    setEnterpriseLead({
                      ...enterpriseLead,
                      notes: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 p-2.5"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEnterpriseModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#0A0A0B] text-white font-bold"
              >
                Submit Enterprise Inquiry
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MODULE 7: COMMISSION DASHBOARD (DUAL VIEWS: BUSINESS OWNER & SALESPERSON)
// ============================================================================
// ============================================================================
// PROFILE PAGE (opened from the profile block at the bottom of the menu) — has the Sign Out button
// ============================================================================
function ProfilePage({ session, roleText, accessText, orgName, record, onSignOut }) {
  const rows = [
    ["Name", session?.name || "—"],
    ["Email", session?.email || "—"],
    ["Role", roleText || "—"],
    ["Access Level", accessText || "—"],
    ["Organisation", orgName || "—"],
    ...(record
      ? [
        ["ID", record.id],
        ["Type", record.type],
        ["Department / Branch", `${record.department} / ${record.branch}`],
        ["Manager", record.manager],
        ["Joining Date", record.joiningDate],
        ["Commission Plan", record.planName],
        ["Status", record.status],
      ]
      : []),
  ];
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-red-600 to-orange-500 text-white flex items-center justify-center text-xl font-extrabold shrink-0">
            {(session?.name || session?.email || "US").trim().slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold text-slate-900 truncate">
              {session?.name || "User"}
            </h2>
            <p className="text-sm text-slate-500 truncate">{session?.email}</p>
            <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-bold">
              {roleText}
            </span>
          </div>
        </div>
        <button
          type="button"
          data-allow="all"
          onClick={onSignOut}
          className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold inline-flex items-center gap-2"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <h3 className="text-base font-bold text-slate-900 mb-3">Profile Details</h3>
        <div className="divide-y divide-slate-100 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-3">
              <span className="text-slate-500">{k}</span>
              <span className="font-bold text-slate-900 text-right break-all">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModuleDashboard({
  org,
  roleView,
  setRoleView,
  employees,
  transactions,
  reversals,
  adjustments,
  onlyMine = false,
  setActiveModule,
}) {
  const [dateFilter, setDateFilter] = useState("Nov 2026");
  const [kpiDetail, setKpiDetail] = useState(null);

  const ownerKpis = [
    {
      label: "Total Eligible Sales",
      value: "₹25,00,000",
      sub: "+18.4% vs last month",
      accent: "from-blue-600 to-indigo-600",
      badge: "Verified Base",
      icon: ArrowUpRight,
    },
    {
      label: "Calculated Commission",
      value: "₹1,50,000",
      sub: "6.0% effective blended rate",
      accent: "from-indigo-600 to-violet-600",
      badge: "7 Active Plans",
      icon: Calculator,
    },
    {
      label: "Pending Commission",
      value: "₹30,000",
      sub: "Awaiting Finance & Manager sign-off",
      accent: "from-amber-500 to-orange-500",
      badge: "In Review",
      icon: Clock,
    },
    {
      label: "Approved Commission",
      value: "₹80,000",
      sub: "Locked & ready for payout batch",
      accent: "from-emerald-600 to-teal-600",
      badge: "Finalised",
      icon: CheckCircle2,
    },
    {
      label: "Paid Commission",
      value: "₹40,000",
      sub: "Disbursed via NEFT / Bank Transfer",
      accent: "from-sky-600 to-cyan-600",
      badge: "Reconciled",
      icon: Wallet,
    },
    {
      label: "Outstanding Payouts",
      value: "₹40,000",
      sub: "Scheduled for 15-11-2026 batch",
      accent: "from-slate-800 to-slate-700",
      badge: "Payable",
      icon: Briefcase,
    },
    {
      label: "Reversed Commission",
      value: "₹5,000",
      sub: "Clawbacks from refunds & cancellations",
      accent: "from-rose-600 to-pink-600",
      badge: "Clawback",
      icon: RotateCcw,
    },
  ];

  // partner view: every card shows only that partner's own numbers
  const myRow = employees[0] || {};
  const num = (v) => Number(v) || 0;
  const mineValues = {
    "Total Eligible Sales": transactions.reduce((t, x) => t + num(x.eligibleBase), 0), // same total as the details popup (own transactions)
    "Calculated Commission": num(myRow.earnedCommission),
    "Pending Commission": num(myRow.pendingCommission),
    "Approved Commission": num(myRow.approvedCommission),
    "Paid Commission": num(myRow.paidCommission),
    "Outstanding Payouts": Math.max(0, num(myRow.approvedCommission) - num(myRow.paidCommission)),
    "Reversed Commission": reversals.reduce((t, r) => t + num(r.reversedCommission), 0),
  };
  const mineSubs = {
    "Total Eligible Sales": "Your validated sales",
    "Calculated Commission": "Your earned commission",
    "Pending Commission": "Awaiting sign-off",
    "Approved Commission": "Ready for payout",
    "Paid Commission": "Already paid to you",
    "Outstanding Payouts": "Approved minus paid",
    "Reversed Commission": "Clawbacks on your refunds",
  };
  const kpiList = onlyMine
    ? ownerKpis.map((k) => ({
      ...k,
      value: formatINR(mineValues[k.label]),
      sub: mineSubs[k.label],
      badge: "Your data",
    }))
    : ownerKpis;

  const monthlySeries = [
    { month: "Jun", sales: 16.5, comm: 0.98 },
    { month: "Jul", sales: 18.2, comm: 1.09 },
    { month: "Aug", sales: 19.8, comm: 1.18 },
    { month: "Sep", sales: 21.4, comm: 1.28 },
    { month: "Oct", sales: 22.9, comm: 1.37 },
    { month: "Nov", sales: 25.0, comm: 1.5 },
  ];

  // Decorative illustration shown behind each KPI card (inline SVG, no external images)
  const kpiArt = (label) => {
    const wrap = (c, body) =>
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 130' fill='none' stroke='${c}' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`;
    const map = {
      "Total Eligible Sales": ["#2563eb", `<path d='M20 112h165'/><rect x='30' y='80' width='24' height='32' rx='3'/><rect x='70' y='62' width='24' height='50' rx='3'/><rect x='110' y='42' width='24' height='70' rx='3'/><rect x='150' y='20' width='24' height='92' rx='3'/><path d='M28 62l45-24 38 12 56-34'/><path d='M150 16h20v20'/>`],
      "Calculated Commission": ["#6366f1", `<rect x='45' y='14' width='90' height='108' rx='12'/><rect x='58' y='28' width='64' height='22' rx='4'/><circle cx='68' cy='68' r='4'/><circle cx='90' cy='68' r='4'/><circle cx='112' cy='68' r='4'/><circle cx='68' cy='88' r='4'/><circle cx='90' cy='88' r='4'/><circle cx='112' cy='88' r='4'/><path d='M150 30l30 40M152 36a6 6 0 100 .1M178 66a6 6 0 100 .1'/>`],
      "Pending Commission": ["#f59e0b", `<path d='M60 14h80M60 118h80'/><path d='M66 14c0 40 34 40 34 52s-34 12-34 52M134 14c0 40-34 40-34 52s34 12 34 52'/><path d='M82 100h36'/>`],
      "Approved Commission": ["#059669", `<path d='M100 12l62 22v34c0 38-26 56-62 68-36-12-62-30-62-68V34z'/><path d='M70 70l22 22 40-44'/>`],
      "Paid Commission": ["#0284c7", `<rect x='24' y='34' width='140' height='84' rx='14'/><path d='M24 54h140'/><path d='M130 12l36 14'/><circle cx='138' cy='86' r='10'/><path d='M44 98h40'/>`],
      "Outstanding Payouts": ["#475569", `<rect x='28' y='28' width='144' height='94' rx='12'/><path d='M28 56h144M62 14v26M138 14v26'/><path d='M60 84h28M112 84h28M60 104h28'/>`],
      "Reversed Commission": ["#e11d48", `<path d='M150 52a56 56 0 10 6 40'/><path d='M158 20v34h-34'/><path d='M84 62h30M84 82h30'/>`],
    };
    const [c, body] = map[label] || map["Total Eligible Sales"];
    return { color: c, url: `url("data:image/svg+xml;utf8,${encodeURIComponent(wrap(c, body))}")` };
  };

  const renderKpi = (kpi, idx) => {
    const Icon = kpi.icon;
    const art = kpiArt(kpi.label);
    return (
      <div
        key={idx}
        role="button"
        tabIndex={0}
        data-allow="all"
        onClick={() => setKpiDetail(kpi)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setKpiDetail(kpi);
        }}
        title="Click to view full details"
        style={{ backgroundImage: `linear-gradient(135deg, ${art.color}14, transparent 60%)` }}
        className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs hover:shadow-md hover:border-blue-300 transition flex flex-col gap-3 cursor-pointer relative overflow-hidden group"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-3 -bottom-2 w-44 h-28 opacity-[0.16] group-hover:opacity-30 group-hover:scale-110 transition-all duration-500 bg-no-repeat bg-contain bg-right-bottom"
          style={{ backgroundImage: art.url }}
        />
        <div className="flex items-center justify-between relative">
          <div
            className={`w-10 h-10 rounded-xl bg-gradient-to-br ${kpi.accent} text-white flex items-center justify-center shadow-sm`}
          >
            <Icon className="w-5 h-5" />
          </div>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 whitespace-nowrap">
            {kpi.badge}
          </span>
        </div>
        <div className="relative">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {kpi.label}
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-0.5 tracking-tight">
            {kpi.value}
          </div>
        </div>
        <div className="relative pt-3 mt-auto border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between gap-2">
          <span>{kpi.sub}</span>
          <span className="text-blue-600 font-semibold whitespace-nowrap">Details →</span>
        </div>
      </div>
    );
  };

  // ---- full-detail popup for every KPI card (built from live data) ----
  const sum = (arr, f) => arr.reduce((t, x) => t + (Number(f(x)) || 0), 0);
  const peopleTable = (title, field, totalLabel) => {
    const rows = employees.map((e) => ({ ...e, v: field(e) }));
    return {
      total: sum(rows, (r) => r.v),
      totalLabel,
      headers: ["ID", "Name", "Type", "Plan", "Eligible Sales", title],
      rows: rows.map((r) => [
        r.id, r.name, r.type, r.planName, formatINR(r.eligibleSales), formatINR(r.v),
      ]),
    };
  };
  const buildKpiDetail = (label) => {
    switch (label) {
      case "Total Eligible Sales": {
        const bySp = {};
        transactions.forEach((t) => {
          bySp[t.salesperson] = (bySp[t.salesperson] || 0) + (Number(t.eligibleBase) || 0);
        });
        return {
          total: sum(transactions, (t) => t.eligibleBase),
          totalLabel: "Total Eligible Base (all transactions)",
          summary: Object.entries(bySp).map(([k, v]) => [k, formatINR(v)]),
          summaryTitle: "By Salesperson / Partner",
          headers: ["Txn ID", "Invoice", "Customer", "Product", "Date", "Salesperson", "Invoice Amt", "Discount", "Eligible Base", "Status"],
          rows: transactions.map((t) => [
            t.id, t.invoiceNumber, t.customer, t.product, t.date, t.salesperson,
            formatINR(t.invoiceAmount), formatINR(t.discount), formatINR(t.eligibleBase), t.status,
          ]),
        };
      }
      case "Calculated Commission":
        return peopleTable("Calculated Commission", (e) => e.earnedCommission, "Total Calculated Commission");
      case "Pending Commission":
        return peopleTable("Pending", (e) => e.pendingCommission, "Total Pending Commission");
      case "Approved Commission":
        return peopleTable("Approved", (e) => e.approvedCommission, "Total Approved Commission");
      case "Paid Commission":
        return peopleTable("Paid", (e) => e.paidCommission, "Total Paid Commission");
      case "Outstanding Payouts":
        return peopleTable("Outstanding (Approved − Paid)", (e) => Math.max(0, (Number(e.approvedCommission) || 0) - (Number(e.paidCommission) || 0)), "Total Outstanding Payouts");
      case "Reversed Commission":
        return {
          total: sum(reversals, (r) => r.reversedCommission),
          totalLabel: "Total Reversed Commission",
          headers: ["Reversal ID", "Original TXN", "Employee", "Type", "Original Comm.", "Refund Amt", "Reversed", "Remaining", "Reason"],
          rows: reversals.map((r) => [
            r.id, `${r.transactionId} (${r.invoiceNumber})`, r.employee, r.type,
            formatINR(r.originalCommission), formatINR(r.refundAmount),
            formatINR(r.reversedCommission), formatINR(r.remainingCommission), r.reason,
          ]),
        };
      default:
        return { total: 0, totalLabel: "", headers: [], rows: [] };
    }
  };
  const detail = kpiDetail ? buildKpiDetail(kpiDetail.label) : null;

  return (
    <div className="space-y-6">
      {kpiDetail && detail && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setKpiDetail(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-5xl w-full shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">{kpiDetail.label}</h3>
                <p className="text-xs text-slate-500">
                  {kpiDetail.sub} • Period: {dateFilter}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setKpiDetail(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto text-xs">
              <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex items-center justify-between">
                <span className="font-semibold text-blue-800">{detail.totalLabel}</span>
                <span className="text-xl font-extrabold text-blue-950">{formatINR(detail.total)}</span>
              </div>
              {detail.summary && detail.summary.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-bold uppercase text-slate-500 mb-2">
                    {detail.summaryTitle}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {detail.summary.map(([k, v]) => (
                      <span key={k} className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 font-semibold text-slate-800">
                        {k}: <strong>{v}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                      {detail.headers.map((h) => (
                        <th key={h} className="whitespace-nowrap py-3 px-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.rows.length === 0 && (
                      <tr>
                        <td colSpan={detail.headers.length} className="py-6 text-center text-slate-400">
                          No records found.
                        </td>
                      </tr>
                    )}
                    {detail.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {row.map((c, j) => (
                          <td key={j} className="whitespace-nowrap py-2.5 px-3 text-slate-800">{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Executive Welcome Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0A0A0B] via-[#400C0C] to-[#0A0A0B] text-white p-6 shadow-lg border border-slate-800">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-medium text-blue-200 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              {org.name} • Live Revenue & Incentive Intelligence
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Executive Commission Command Center
            </h2>
            <p className="text-sm text-slate-300 mt-1 max-w-2xl">
              Real-time visibility across eligible sales, multi-model commission accruals, approval bottlenecks, and payout liabilities.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-white/10 border border-white/20 text-white text-xs font-semibold rounded-xl px-3.5 py-2.5 focus:outline-none"
            >
              <option value="Nov 2026" className="text-slate-900">
                Period: November 2026
              </option>
              <option value="Oct 2026" className="text-slate-900">
                Period: October 2026
              </option>
              <option value="Q3 FY26" className="text-slate-900">
                Quarter: Q3 FY 2026-27
              </option>
            </select>

          </div>
        </div>
      </div>

      {/* VIEW A: BUSINESS OWNER DASHBOARD */}
      {(
        <div key={`owner-${dateFilter}`} className="space-y-6 anim-switch">
          {/* KPI cards: 4 + 3 */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {kpiList.slice(0, 4).map(renderKpi)}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {kpiList.slice(4).map((k, i) => renderKpi(k, i + 4))}
            </div>
          </div>

          {/* Analytics Row */}
          {!onlyMine && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Monthly Eligible Sales & Commission Trend
                  </h3>
                  <p className="text-xs text-slate-500">
                    6-month progression in ₹ Lakhs ({dateFilter})
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs font-medium text-slate-700">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-blue-600" /> Eligible
                    Sales
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-emerald-500" />
                    <span className="w-2 h-2 rounded-full bg-emerald-500 -ml-2" />{" "}
                    Commission
                  </span>
                </div>
              </div>
              <svg viewBox="0 0 560 250" className="w-full h-auto">
                {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                  const y = 20 + 180 * (1 - t);
                  return (
                    <g key={t}>
                      <line
                        x1="44"
                        x2="520"
                        y1={y}
                        y2={y}
                        stroke="#E4E4E7"
                        strokeDasharray="3 3"
                      />
                      <text
                        x="38"
                        y={y + 3}
                        fontSize="10"
                        textAnchor="end"
                        fill="#71717A"
                      >
                        ₹{Math.round(28 * t)}L
                      </text>
                      <text
                        x="526"
                        y={y + 3}
                        fontSize="10"
                        textAnchor="start"
                        fill="#059669"
                      >
                        {(2 * t).toFixed(1)}L
                      </text>
                    </g>
                  );
                })}
                {monthlySeries.map((d, i) => {
                  const slot = 476 / monthlySeries.length;
                  const cx = 44 + slot * i + slot / 2;
                  const h = (d.sales / 28) * 180;
                  return (
                    <g key={d.month}>
                      <rect
                        x={cx - 20}
                        y={200 - h}
                        width="40"
                        height={h}
                        rx="6"
                        fill="#DC2626"
                        opacity="0.92"
                      >
                        <title>{`${d.month}: ₹${d.sales}L sales`}</title>
                      </rect>
                      <text
                        x={cx}
                        y={200 - h - 6}
                        fontSize="10"
                        fontWeight="700"
                        textAnchor="middle"
                        fill="#1E3A8A"
                      >
                        ₹{d.sales}L
                      </text>
                      <text
                        x={cx}
                        y="220"
                        fontSize="11"
                        fontWeight="600"
                        textAnchor="middle"
                        fill="#52525B"
                      >
                        {d.month}
                      </text>
                    </g>
                  );
                })}
                <polyline
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2.5"
                  points={monthlySeries
                    .map(
                      (d, i) =>
                        `${44 + (476 / monthlySeries.length) * i + 476 / monthlySeries.length / 2},${200 - (d.comm / 2) * 180}`,
                    )
                    .join(" ")}
                />
                {monthlySeries.map((d, i) => (
                  <circle
                    key={d.month}
                    cx={
                      44 +
                      (476 / monthlySeries.length) * i +
                      476 / monthlySeries.length / 2
                    }
                    cy={200 - (d.comm / 2) * 180}
                    r="4.5"
                    fill="#fff"
                    stroke="#10B981"
                    strokeWidth="2.5"
                  >
                    <title>{`${d.month}: ₹${d.comm}L commission`}</title>
                  </circle>
                ))}
              </svg>
            </div>

            {/* Team Target Achievement */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col">
              <h3 className="text-base font-bold text-slate-900">
                Team Target Achievement
              </h3>
              <p className="text-xs text-slate-500 mb-5">
                Quota attainment across departments
              </p>
              <div className="space-y-4 flex-1">
                {[
                  {
                    team: "Sales (Bangalore)",
                    achieved: 124,
                    amount: "₹11.2L / ₹9.0L",
                    color: "bg-emerald-500",
                  },
                  {
                    team: "Enterprise (Mumbai)",
                    achieved: 98,
                    amount: "₹7.8L / ₹8.0L",
                    color: "bg-blue-600",
                  },
                  {
                    team: "Inside Sales (Hyd)",
                    achieved: 108,
                    amount: "₹4.3L / ₹4.0L",
                    color: "bg-indigo-500",
                  },
                  {
                    team: "Channel Partners",
                    achieved: 83,
                    amount: "₹2.5L / ₹3.0L",
                    color: "bg-amber-500",
                  },
                ].map((t) => (
                  <div key={t.team}>
                    <div className="flex justify-between items-baseline text-xs font-semibold mb-1.5 gap-2">
                      <span className="text-slate-800">{t.team}</span>
                      <span className="text-slate-500 font-medium whitespace-nowrap">
                        <strong className="text-slate-900">
                          {t.achieved}%
                        </strong>{" "}
                        · {t.amount}
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${t.color}`}
                        style={{ width: `${Math.min(100, t.achieved)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold text-slate-500">
                    Outstanding Payout Summary
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    ₹40,000 across 3 batches
                  </div>
                </div>
                <button
                  data-allow="all"
                  onClick={() => setActiveModule("payouts")}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 whitespace-nowrap"
                >
                  Reconcile →
                </button>
              </div>
            </div>
          </div>
          )}

          {/* Top Performing Employees Leaderboard */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Top-Performing Employees & Partners
                </h3>
                <p className="text-xs text-slate-500">
                  Ranked by net eligible sales & earned incentives
                </p>
              </div>
              <button
                data-allow="all"
                onClick={() => setActiveModule("employees")}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Full Directory
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                    <th className="whitespace-nowrap py-3 px-3">Rank</th>
                    <th className="whitespace-nowrap py-3 px-3">
                      Employee / Partner
                    </th>
                    <th className="whitespace-nowrap py-3 px-3">Department</th>
                    <th className="whitespace-nowrap py-3 px-3">
                      Assigned Plan
                    </th>
                    <th className="whitespace-nowrap py-3 px-3 text-right">
                      Eligible Sales
                    </th>
                    <th className="whitespace-nowrap py-3 px-3 text-right">
                      Earned Comm.
                    </th>
                    <th className="whitespace-nowrap py-3 px-3 text-right">
                      Quota %
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {[...employees]
                    .sort((a, b) => b.eligibleSales - a.eligibleSales)
                    .map((emp, idx) => {
                      const pct = Math.round(
                        (emp.eligibleSales / emp.monthlyTarget) * 100,
                      );
                      return (
                        <tr key={emp.id} className="hover:bg-slate-50/80">
                          <td className="whitespace-nowrap py-3 px-3 font-bold text-blue-600">
                            #{idx + 1}
                          </td>
                          <td className="whitespace-nowrap py-3 px-3 font-semibold text-slate-900">
                            {emp.name}{" "}
                            <span className="text-slate-400 font-normal">
                              ({emp.id})
                            </span>
                          </td>
                          <td className="whitespace-nowrap py-3 px-3 text-slate-600">
                            {emp.department}
                          </td>
                          <td className="whitespace-nowrap py-3 px-3">
                            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-medium">
                              {emp.planName}
                            </span>
                          </td>
                          <td className="whitespace-nowrap py-3 px-3 text-right font-semibold">
                            {formatINR(emp.eligibleSales)}
                          </td>
                          <td className="whitespace-nowrap py-3 px-3 text-right font-bold text-emerald-700">
                            {formatINR(emp.earnedCommission)}
                          </td>
                          <td className="whitespace-nowrap py-3 px-3 text-right">
                            <span
                              className={`px-2 py-0.5 rounded-full font-semibold ${pct >= 100
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                                }`}
                            >
                              {pct}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MODULE 2: EMPLOYEE & PARTNER DIRECTORY
// ============================================================================
function ModuleEmployees({
  employees,
  setEmployees,
  policies,
  departments,
  isPartner = false,
  notify,
}) {
  const [search, setSearch] = useState("");
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);

  const emptyForm = {
    id: `EMP00${employees.length + 1}`,
    name: "",
    email: "",
    phone: "",
    department: "Sales",
    branch: "Bangalore",
    manager: "Suresh",
    joiningDate: "01-01-2026",
    exitDate: "",
    eligibility: "Active",
    planId: policies[0]?.id || "POL001",
    planName: policies[0]?.name || "Sales Plan A",
    status: "Active",
    type: "Employee",
    monthlyTarget: 500000,
    eligibleSales: 0,
    earnedCommission: 0,
    pendingCommission: 0,
    approvedCommission: 0,
    paidCommission: 0,
  };

  const [form, setForm] = useState(emptyForm);

  const nextRecordId = (type) => {
    const prefix = type === "Partner" ? "PRT" : "EMP";
    const nums = employees
      .filter((x) => String(x.id).startsWith(prefix))
      .map((x) => parseInt(String(x.id).replace(/\D/g, ""), 10) || 0);
    return `${prefix}${String(Math.max(0, ...nums) + 1).padStart(3, "0")}`;
  };

  const openAdd = (type = "Employee") => {
    setEditingEmp(null);
    setForm({ ...emptyForm, type, id: nextRecordId(type) });
    setModalOpen(true);
  };

  const openEdit = (emp) => {
    setEditingEmp(emp.id);
    setForm(emp);
    setModalOpen(true);
  };

  const handleSave = (e) => {
    e.preventDefault();
    const chosenPlan = policies.find((p) => p.id === form.planId);
    const updatedRecord = {
      ...form,
      planName: chosenPlan ? chosenPlan.name : form.planName,
    };
    if (editingEmp) {
      setEmployees((prev) =>
        prev.map((x) => (x.id === editingEmp ? updatedRecord : x)),
      );
      notify(
        `Updated profile for ${updatedRecord.name} (${updatedRecord.id}).`,
      );
    } else {
      setEmployees((prev) => [...prev, updatedRecord]);
      notify(`Added ${updatedRecord.name} (${updatedRecord.id}) to directory.`);
    }
    setModalOpen(false);
  };

  const toggleStatus = (emp) => {
    const nextStatus = emp.status === "Active" ? "Inactive" : "Active";
    setEmployees((prev) =>
      prev.map((x) =>
        x.id === emp.id
          ? {
            ...x,
            status: nextStatus,
            eligibility: nextStatus === "Active" ? "Active" : "Suspended",
          }
          : x,
      ),
    );
    notify(`${emp.name} status set to ${nextStatus}.`);
  };

  const filtered = employees.filter(
    (e) =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.id.toLowerCase().includes(search.toLowerCase()) ||
      e.department.toLowerCase().includes(search.toLowerCase()),
  );

  const employeeRows = filtered.filter((e) => e.type !== "Partner");
  const partnerRows = filtered.filter((e) => e.type === "Partner");

  const renderTable = (list, kind) => (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white">
          <h3 className="text-sm font-extrabold text-slate-900">
            {kind === "Partner" ? "Partners" : "Employees"}
          </h3>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {list.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                <th className="whitespace-nowrap py-3.5 px-3">{kind} ID</th>
                <th className="whitespace-nowrap py-3.5 px-3">{kind} Name</th>
                <th className="whitespace-nowrap py-3.5 px-3">Email & Phone</th>
                <th className="whitespace-nowrap py-3.5 px-3">
                  Department / Branch
                </th>
                <th className="whitespace-nowrap py-3.5 px-3">Manager</th>
                <th className="whitespace-nowrap py-3.5 px-3">Joining Date</th>
                <th className="whitespace-nowrap py-3.5 px-3">Exit Date</th>
                <th className="whitespace-nowrap py-3.5 px-3">Eligibility</th>
                <th className="whitespace-nowrap py-3.5 px-3">
                  Commission Plan
                </th>
                <th className="whitespace-nowrap py-3.5 px-3">Status</th>
                <th className="whitespace-nowrap py-3.5 px-3 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-6 px-3 text-center text-slate-400">
                    No {kind.toLowerCase()}s found.
                  </td>
                </tr>
              )}
              {list.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50/90">
                  <td className="whitespace-nowrap py-3.5 px-3 font-bold text-blue-600">
                    {emp.id}
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-3">
                    <div className="font-bold text-slate-900">{emp.name}</div>
                    <div className="text-[11px] text-slate-400">{emp.type}</div>
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-3">
                    <div className="text-slate-800">{emp.email}</div>
                    <div className="text-slate-500">{emp.phone}</div>
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-3">
                    <div className="font-semibold text-slate-800">
                      {emp.department}
                    </div>
                    <div className="text-slate-500">{emp.branch}</div>
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-3 font-medium text-slate-700">
                    {emp.manager}
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-3 text-slate-600">
                    {emp.joiningDate}
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-3">
                    {emp.exitDate ? (
                      <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 font-semibold">
                        {emp.exitDate}
                      </span>
                    ) : (
                      <span className="text-slate-300 font-semibold">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-md font-semibold ${emp.eligibility === "Active"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-600"
                        }`}
                    >
                      {emp.eligibility}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-3">
                    <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-semibold">
                      {emp.planName}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-3">
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-semibold ${emp.status === "Active"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-rose-100 text-rose-800"
                        }`}
                    >
                      {emp.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        onClick={() => setSelectedEmp(emp)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-blue-100 text-slate-700 hover:text-blue-700"
                        title="View Profile & Commissions"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => openEdit(emp)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-700"
                        title="Edit Details / Assign Plan, Manager, Dept"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => toggleStatus(emp)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-700 hover:text-rose-700"
                        title={
                          emp.status === "Active"
                            ? "Deactivate Employee"
                            : "Activate Employee"
                        }
                      >
                        {emp.status === "Active" ? (
                          <UserX className="w-3.5 h-3.5" />
                        ) : (
                          <UserCheck className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
  );

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Employee ID (EMP001), Name (Rahul), or Department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-300 text-xs focus:border-blue-600 focus:outline-none"
          />
        </div>
        {!isPartner && (
        <div className="flex items-center gap-2">
          <button
            data-allow="user"
            onClick={() => openAdd("Employee")}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 shadow-xs"
          >
            <Plus className="w-4 h-4" /> Add Employee
          </button>
          <button
            data-allow="user"
            onClick={() => openAdd("Partner")}
            className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center gap-2 shadow-xs"
          >
            <Plus className="w-4 h-4" /> Add Partner
          </button>
        </div>
        )}
      </div>

      {renderTable(employeeRows, "Employee")}

      {renderTable(partnerRows, "Partner")}

      {/* Profile Modal */}
      {selectedEmp && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <span className="text-xs font-bold text-blue-600">
                  {selectedEmp.id} • {selectedEmp.type}
                </span>
                <h3 className="text-xl font-extrabold text-slate-900">
                  {selectedEmp.name}
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedEmp.email} • {selectedEmp.phone} •{" "}
                  {selectedEmp.department} ({selectedEmp.branch})
                </p>
              </div>
              <button
                onClick={() => setSelectedEmp(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Reporting Manager</div>
                <div className="font-bold text-slate-900 mt-0.5">
                  {selectedEmp.manager}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Joining Date</div>
                <div className="font-bold text-slate-900 mt-0.5">
                  {selectedEmp.joiningDate}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Exit Date</div>
                <div
                  className={`font-bold mt-0.5 ${selectedEmp.exitDate ? "text-rose-700" : "text-slate-400"}`}
                >
                  {selectedEmp.exitDate || "Currently working"}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                <div className="text-blue-600">Commission Plan</div>
                <div className="font-bold text-blue-950 mt-0.5">
                  {selectedEmp.planName}
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">
                Individual Sales Performance & Commission Breakdown
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="p-3 rounded-xl bg-[#0A0A0B] text-white">
                  <div className="text-[11px] text-slate-300">
                    Eligible Sales
                  </div>
                  <div className="text-sm font-extrabold mt-1">
                    {formatINR(selectedEmp.eligibleSales)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                  <div className="text-[11px] text-blue-700">Earned</div>
                  <div className="text-sm font-extrabold text-blue-950 mt-1">
                    {formatINR(selectedEmp.earnedCommission)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <div className="text-[11px] text-amber-700">Pending</div>
                  <div className="text-sm font-extrabold text-amber-950 mt-1">
                    {formatINR(selectedEmp.pendingCommission)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <div className="text-[11px] text-emerald-700">Approved</div>
                  <div className="text-sm font-extrabold text-emerald-950 mt-1">
                    {formatINR(selectedEmp.approvedCommission)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-sky-50 border border-sky-200">
                  <div className="text-[11px] text-sky-700">Paid</div>
                  <div className="text-sm font-extrabold text-sky-950 mt-1">
                    {formatINR(selectedEmp.paidCommission)}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  const emp = selectedEmp;
                  setSelectedEmp(null);
                  openEdit(emp);
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold"
              >
                Edit / Reassign Plan
              </button>
              <button
                onClick={() => setSelectedEmp(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Employee Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            data-allow="user"
            onSubmit={handleSave}
            className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingEmp
                  ? `Edit ${form.type || "Employee"} (${editingEmp})`
                  : `Add ${form.type || "Employee"}`}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {!editingEmp && (
              <div className="flex gap-2 p-1 rounded-xl bg-slate-100 text-xs font-bold">
                {["Employee", "Partner"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() =>
                      setForm({ ...form, type: t, id: nextRecordId(t) })
                    }
                    className={`flex-1 py-2 rounded-lg transition ${form.type === t ? "bg-white shadow text-blue-700" : "text-slate-500 hover:text-slate-800"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  {form.type || "Employee"} ID
                </label>
                <input
                  required
                  value={form.id}
                  onChange={(e) => setForm({ ...form, id: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  {form.type || "Employee"} Name *
                </label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Phone
                </label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Assign Department
                </label>
                <select
                  value={form.department}
                  onChange={(e) =>
                    setForm({ ...form, department: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Branch
                </label>
                <input
                  value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Assign Manager
                </label>
                <input
                  value={form.manager}
                  onChange={(e) =>
                    setForm({ ...form, manager: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Joining Date
                </label>
                <input
                  type="date"
                  value={dmyToIso(form.joiningDate)}
                  onChange={(e) =>
                    setForm({ ...form, joiningDate: isoToDmy(e.target.value) })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Exit Date{" "}
                  <span className="font-normal text-slate-400">
                    (blank if working)
                  </span>
                </label>
                <input
                  type="date"
                  value={dmyToIso(form.exitDate)}
                  min={dmyToIso(form.joiningDate)}
                  onChange={(e) =>
                    setForm({ ...form, exitDate: isoToDmy(e.target.value) })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Assign Commission Plan
                </label>
                <select
                  value={form.planId}
                  onChange={(e) => setForm({ ...form, planId: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
                >
                  {policies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.modelLabel})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Commission Eligibility & Status
                </label>
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: e.target.value,
                      eligibility: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-xs font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold"
              >
                Save Record
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MODULE 3: COMMISSION POLICIES (ALL 7 MODELS + SIMULATOR + VERSIONS)
// ============================================================================
function ModulePolicies({ policies, setPolicies, canManage = true, notify }) {
  const [selectedPolicy, setSelectedPolicy] = useState(policies[0]);
  const [simSales, setSimSales] = useState(400000);
  const [simCount, setSimCount] = useState(10);
  const [simProduct, setSimProduct] = useState("Product A");
  const [versionModalPolicy, setVersionModalPolicy] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState(null);

  const [newPolicy, setNewPolicy] = useState({
    name: "",
    model: "A",
    description: "",
    rate: 5,
    fixedAmount: 500,
    tierMethod: "marginal",
    slabs: [
      { min: 0, max: 100000, rate: 2 },
      { min: 100001, max: 300000, rate: 4 },
      { min: 300001, max: 99999999, rate: 6 },
    ],
    targetAmount: 500000,
    targetBonus: 10000,
    productRates: [
      { product: "Product A", rate: 3 },
      { product: "Product B", rate: 5 },
      { product: "Product C", rate: 8 },
    ],
    referralRate: 5,
    multiLevelSplits: [
      { role: "Sales Representative", share: 70 },
      { role: "Sales Manager", share: 20 },
      { role: "Referral Partner", share: 10 },
    ],
    eligibleGroup: "Sales Team",
    effectiveFrom: "2026-11-01",
    effectiveTo: "2027-03-31",
    reversalRule: "Proportional reversal within 45 days of refund",
  });

  const modelNames = {
    A: "A. Fixed Percentage Commission",
    B: "B. Fixed Amount Per Sale",
    C: "C. Tier-Based Commission",
    D: "D. Target-Based Incentives",
    E: "E. Product-Based Commission",
    F: "F. Referral Commission",
    G: "G. Multi-Level Commission",
  };

  const defaultNewPolicy = {
    name: "",
    model: "A",
    description: "",
    rate: 5,
    fixedAmount: 500,
    tierMethod: "marginal",
    slabs: [
      { min: 0, max: 100000, rate: 2 },
      { min: 100001, max: 300000, rate: 4 },
      { min: 300001, max: 99999999, rate: 6 },
    ],
    targetAmount: 500000,
    targetBonus: 10000,
    productRates: [
      { product: "Product A", rate: 3 },
      { product: "Product B", rate: 5 },
      { product: "Product C", rate: 8 },
    ],
    referralRate: 5,
    multiLevelSplits: [
      { role: "Sales Representative", share: 70 },
      { role: "Sales Manager", share: 20 },
      { role: "Referral Partner", share: 10 },
    ],
    eligibleGroup: "Sales Team",
    effectiveFrom: "2026-11-01",
    effectiveTo: "2027-03-31",
    reversalRule: "Proportional reversal within 45 days of refund",
  };

  const openCreate = () => {
    setEditingPolicyId(null);
    setNewPolicy(JSON.parse(JSON.stringify(defaultNewPolicy)));
    setCreateOpen(true);
  };

  const openEditPolicy = (pol) => {
    setEditingPolicyId(pol.id);
    setNewPolicy(JSON.parse(JSON.stringify({ ...defaultNewPolicy, ...pol })));
    setCreateOpen(true);
  };

  const handleDeletePolicy = (pol) => {
    if (!window.confirm(`Delete policy "${pol.name}" (${pol.id})? This cannot be undone.`)) return;
    const remaining = policies.filter((p) => p.id !== pol.id);
    setPolicies(remaining);
    if (selectedPolicy?.id === pol.id) setSelectedPolicy(remaining[0]);
    notify(`Policy "${pol.name}" deleted.`);
  };

  const nextPolicyId = () => {
    const nums = policies.map((p) => parseInt(String(p.id).replace(/\D/g, ""), 10) || 0);
    return `POL00${Math.max(0, ...nums) + 1}`;
  };

  const handleCreatePolicy = (e) => {
    e.preventDefault();
    if (editingPolicyId) {
      const old = policies.find((p) => p.id === editingPolicyId);
      const [maj, min] = String(old?.version || "v1.0").replace("v", "").split(".").map((n) => parseInt(n, 10) || 0);
      const nextVersion = `v${maj}.${(min || 0) + 1}`;
      const updated = {
        ...old,
        ...newPolicy,
        id: editingPolicyId,
        modelLabel: modelNames[newPolicy.model],
        version: nextVersion,
        versions: [
          ...(old?.versions || []),
          {
            version: nextVersion,
            date: new Date().toLocaleDateString("en-GB").replace(/\//g, "-"),
            author: "Admin",
            notes: `Edited policy (${modelNames[newPolicy.model]})`,
          },
        ],
      };
      setPolicies((prev) => prev.map((p) => (p.id === editingPolicyId ? updated : p)));
      setSelectedPolicy(updated);
      setCreateOpen(false);
      setEditingPolicyId(null);
      notify(`Policy "${updated.name}" updated to ${nextVersion}.`);
      return;
    }
    const created = {
      ...newPolicy,
      id: nextPolicyId(),
      modelLabel: modelNames[newPolicy.model],
      status: "Active",
      version: "v1.0",
      versions: [
        {
          version: "v1.0",
          date: "13-11-2026",
          author: "Arjun Mehta",
          notes: `Created ${modelNames[newPolicy.model]}`,
        },
      ],
    };
    setPolicies((prev) => [...prev, created]);
    setSelectedPolicy(created);
    setCreateOpen(false);
    notify(
      `Policy "${created.name}" (${created.modelLabel}) created & activated!`,
    );
  };

  const togglePolicyActive = (pol) => {
    const next = pol.status === "Active" ? "Inactive" : "Active";
    setPolicies((prev) =>
      prev.map((p) => (p.id === pol.id ? { ...p, status: next } : p)),
    );
    notify(`Policy "${pol.name}" is now ${next}.`);
  };

  const simResult = computePolicyCommission(
    selectedPolicy,
    simSales,
    simCount,
    simProduct,
  );

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0A0A0B] via-[#3B0D0D] to-[#DC2626] text-white p-7 shadow-lg">
        <svg
          className="absolute inset-0 w-full h-full opacity-[0.12]"
          aria-hidden="true"
        >
          <defs>
            <pattern
              id="pol-grid"
              width="32"
              height="32"
              patternUnits="userSpaceOnUse"
            >
              <path d="M32 0H0V32" fill="none" stroke="#fff" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#pol-grid)" />
        </svg>
        <svg
          className="absolute right-6 bottom-0 h-full max-h-44 w-auto hidden md:block"
          viewBox="0 0 320 180"
          aria-hidden="true"
        >
          <g opacity="0.95">
            <rect x="20" y="110" width="34" height="60" rx="6" fill="#FCA5A5" />
            <rect x="66" y="85" width="34" height="85" rx="6" fill="#60A5FA" />
            <rect
              x="112"
              y="55"
              width="34"
              height="115"
              rx="6"
              fill="#3B82F6"
            />
            <rect
              x="158"
              y="25"
              width="34"
              height="145"
              rx="6"
              fill="#FBBF24"
            />
            <polyline
              points="37,100 83,72 129,44 175,14"
              fill="none"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="175" cy="14" r="6" fill="#fff" />
            <path
              d="M262 30 L300 44 V82 C300 106 284 122 262 132 C240 122 224 106 224 82 V44 Z"
              fill="#fff"
              opacity="0.95"
            />
            <path
              d="M246 82 L258 94 L280 68"
              fill="none"
              stroke="#DC2626"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <ellipse cx="248" cy="160" rx="26" ry="8" fill="#FBBF24" />
            <ellipse cx="248" cy="152" rx="26" ry="8" fill="#FCD34D" />
            <ellipse cx="248" cy="144" rx="26" ry="8" fill="#FBBF24" />
            <text
              x="248"
              y="148"
              textAnchor="middle"
              fontSize="11"
              fontWeight="800"
              fill="#92400E"
            >
              ₹
            </text>
          </g>
        </svg>
        <div className="relative max-w-xl space-y-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 border border-white/20 text-[11px] font-bold">
            <ShieldCheck className="w-3.5 h-3.5" /> Commission Policies
          </span>
          <h2 className="text-2xl font-extrabold tracking-tight">
            Define how every rupee of commission is earned
          </h2>
          <p className="text-xs text-blue-100 leading-relaxed">
            Flat %, per-sale, slabs, targets, product mix, referrals and
            multi-level splits — versioned, auditable and used directly by the
            Commission Engine.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="px-3 py-1 rounded-full bg-white/10 text-[11px] font-semibold">
              {policies.length} policies
            </span>
            <span className="px-3 py-1 rounded-full bg-white/10 text-[11px] font-semibold">
              {policies.filter((p) => p.status === "Active").length} active
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Commission Policy Catalog (7 Models Supported)
          </h2>
          <p className="text-xs text-slate-500">
            Configure Fixed %, Per-Sale Flat, Marginal & Attainment Tiers,
            Target Incentives, Product Matrix, Referral, and Multi-Level Splits.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 shadow-sm"
        >
          <Plus className="w-4 h-4" /> Create Commission Policy
        </button>
      </div>

      {/* Live Policy Simulator */}
      <div className="bg-gradient-to-r from-[#0A0A0B] via-[#450D0D] to-[#0A0A0B] text-white rounded-2xl p-6 shadow-md border border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold">
              Live Commission Model Simulator
            </h3>
          </div>
          <span className="text-xs text-blue-200">
            Test any of the 7 commission models in real time
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Select Policy / Model
            </label>
            <select
              value={selectedPolicy?.id}
              onChange={(e) =>
                setSelectedPolicy(policies.find((p) => p.id === e.target.value))
              }
              className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-xs text-white"
            >
              {policies.map((p) => (
                <option key={p.id} value={p.id} className="text-slate-900">
                  {p.name} — {p.modelLabel}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Eligible Sales Amount (₹)
            </label>
            <input
              type="number"
              value={simSales}
              onChange={(e) => setSimSales(Number(e.target.value))}
              className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              {selectedPolicy?.model === "B"
                ? "Number of Closed Sales"
                : "Product SKU (for Model E)"}
            </label>
            {selectedPolicy?.model === "B" ? (
              <input
                type="number"
                value={simCount}
                onChange={(e) => setSimCount(Number(e.target.value))}
                className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-xs text-white"
              />
            ) : (
              <select
                value={simProduct}
                onChange={(e) => setSimProduct(e.target.value)}
                className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-xs text-white"
              >
                <option value="Product A" className="text-slate-900">
                  Product A (3%)
                </option>
                <option value="Product B" className="text-slate-900">
                  Product B (5%)
                </option>
                <option value="Product C" className="text-slate-900">
                  Product C (8%)
                </option>
              </select>
            )}
          </div>
          <div className="p-3.5 rounded-xl bg-emerald-500/20 border border-emerald-400/40">
            <div className="text-[11px] text-emerald-200 font-semibold">
              Simulated Payout
            </div>
            <div className="text-xl font-extrabold text-emerald-300">
              {formatINR(simResult.commission)}
            </div>
            <div
              className="text-[11px] text-slate-200 truncate"
              title={simResult.breakdown}
            >
              {simResult.breakdown}
            </div>
          </div>
        </div>
      </div>

      {/* Policies Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {policies.map((pol) => (
          <div
            key={pol.id}
            onClick={() => setSelectedPolicy(pol)}
            className={`cursor-pointer rounded-2xl bg-white border p-5 shadow-xs transition-all ${selectedPolicy?.id === pol.id
              ? "border-blue-600 ring-2 ring-blue-600/20"
              : "border-slate-200 hover:border-slate-300"
              }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="inline-block px-2.5 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[11px] font-bold mb-1.5">
                  {pol.modelLabel}
                </span>
                <h3 className="text-base font-bold text-slate-900">
                  {pol.name}{" "}
                  <span className="text-xs font-normal text-slate-400">
                    ({pol.version})
                  </span>
                </h3>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${pol.status === "Active"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-200 text-slate-700"
                  }`}
              >
                {pol.status}
              </span>
            </div>

            <p className="text-xs text-slate-600 mt-2">{pol.description}</p>

            {pol.model === "C" && (
              <div className="mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px] space-y-1">
                <div className="font-bold text-slate-700">
                  Calculation Method:{" "}
                  {pol.tierMethod === "marginal"
                    ? "Marginal Slabs"
                    : "Attainment Tiers"}
                </div>
                <div className="flex flex-wrap gap-2">
                  {pol.slabs.map((s, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-white border border-slate-200 rounded"
                    >
                      {formatINR(s.min)}–
                      {s.max >= 99999999 ? "Above" : formatINR(s.max)}:{" "}
                      <strong>{s.rate}%</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {pol.model === "E" && (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                {pol.productRates.map((pr) => (
                  <span
                    key={pr.product}
                    className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 font-semibold text-amber-900"
                  >
                    {pr.product}: {pr.rate}%
                  </span>
                ))}
              </div>
            )}

            {pol.model === "G" && (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                {pol.multiLevelSplits.map((sp) => (
                  <span
                    key={sp.role}
                    className="px-2.5 py-1 rounded-lg bg-purple-50 border border-purple-200 font-semibold text-purple-900"
                  >
                    {sp.role}: {sp.share}%
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
              <div>
                <strong>Eligible:</strong> {pol.eligibleGroup}
              </div>
              <div>
                <strong>Effective:</strong> {pol.effectiveFrom} to{" "}
                {pol.effectiveTo}
              </div>
              <div>
                <strong>Reversal Rule:</strong> {pol.reversalRule}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setVersionModalPolicy(pol);
                }}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800"
              >
                View Versions ({pol.versions?.length || 1})
              </button>
              <div className="flex items-center gap-2">
                {canManage && (
                <button
                  type="button"
                  data-allow="user"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditPolicy(pol);
                  }}
                  className="px-3 py-1 rounded-lg border border-amber-300 text-xs font-semibold text-amber-700 hover:bg-amber-50 flex items-center gap-1"
                >
                  <Edit3 className="w-3 h-3" /> Edit
                </button>
                )}
                {canManage && (
                <button
                  type="button"
                  data-allow="user"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeletePolicy(pol);
                  }}
                  className="px-3 py-1 rounded-lg border border-rose-300 text-xs font-semibold text-rose-700 hover:bg-rose-50 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePolicyActive(pol);
                  }}
                  className="px-3 py-1 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {pol.status === "Active" ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Policy Version History Modal */}
      {versionModalPolicy && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Policy Version History — {versionModalPolicy.name}
              </h3>
              <button onClick={() => setVersionModalPolicy(null)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="space-y-3">
              {(versionModalPolicy.versions || []).map((v) => (
                <div
                  key={v.version}
                  className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                >
                  <div className="flex justify-between font-bold text-slate-900">
                    <span className="text-blue-600">{v.version}</span>
                    <span>{v.date}</span>
                  </div>
                  <p className="text-slate-700 mt-1">{v.notes}</p>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Author: {v.author}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create Policy Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreatePolicy}
            className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingPolicyId ? `Edit Commission Policy (${editingPolicyId})` : "Create New Commission Policy"}
              </h3>
              <button type="button" onClick={() => setCreateOpen(false)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Policy Name *
                </label>
                <input
                  required
                  placeholder="e.g., Q4 Enterprise Accelerator"
                  value={newPolicy.name}
                  onChange={(e) =>
                    setNewPolicy({ ...newPolicy, name: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Select Commission Model *
                </label>
                <select
                  value={newPolicy.model}
                  onChange={(e) =>
                    setNewPolicy({ ...newPolicy, model: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white font-semibold"
                >
                  {Object.entries(modelNames).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {newPolicy.model === "A" && (
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Fixed Commission Percentage (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={newPolicy.rate}
                  onChange={(e) =>
                    setNewPolicy({ ...newPolicy, rate: Number(e.target.value) })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
            )}

            {newPolicy.model === "B" && (
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Fixed Amount Per Sale (₹)
                </label>
                <input
                  type="number"
                  value={newPolicy.fixedAmount}
                  onChange={(e) =>
                    setNewPolicy({
                      ...newPolicy,
                      fixedAmount: Number(e.target.value),
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
            )}

            {newPolicy.model === "C" && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Tier Calculation Method
                  </label>
                  <select
                    value={newPolicy.tierMethod}
                    onChange={(e) =>
                      setNewPolicy({ ...newPolicy, tierMethod: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
                  >
                    <option value="marginal">
                      Marginal Slabs (Each portion calculated at its own rate)
                    </option>
                    <option value="attainment">
                      Attainment Tiers (Achieved-tier rate applies to full base)
                    </option>
                  </select>
                </div>
                <div className="space-y-2">
                  <div className="font-semibold text-slate-700">
                    Configured Slabs (₹0–1L @ 2%, ₹1L–3L @ 4%, &gt;₹3L @ 6%)
                  </div>
                  {newPolicy.slabs.map((s, idx) => (
                    <div key={idx} className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        value={s.min}
                        onChange={(e) => {
                          const copy = [...newPolicy.slabs];
                          copy[idx].min = Number(e.target.value);
                          setNewPolicy({ ...newPolicy, slabs: copy });
                        }}
                        className="rounded-lg border border-slate-300 px-2 py-1.5"
                      />
                      <input
                        type="number"
                        value={s.max}
                        onChange={(e) => {
                          const copy = [...newPolicy.slabs];
                          copy[idx].max = Number(e.target.value);
                          setNewPolicy({ ...newPolicy, slabs: copy });
                        }}
                        className="rounded-lg border border-slate-300 px-2 py-1.5"
                      />
                      <input
                        type="number"
                        value={s.rate}
                        onChange={(e) => {
                          const copy = [...newPolicy.slabs];
                          copy[idx].rate = Number(e.target.value);
                          setNewPolicy({ ...newPolicy, slabs: copy });
                        }}
                        className="rounded-lg border border-slate-300 px-2 py-1.5"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {newPolicy.model === "D" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Monthly Sales Target (₹)
                  </label>
                  <input
                    type="number"
                    value={newPolicy.targetAmount}
                    onChange={(e) =>
                      setNewPolicy({
                        ...newPolicy,
                        targetAmount: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Target Achievement Bonus (₹)
                  </label>
                  <input
                    type="number"
                    value={newPolicy.targetBonus}
                    onChange={(e) =>
                      setNewPolicy({
                        ...newPolicy,
                        targetBonus: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>
            )}

            {newPolicy.model === "E" && (
              <div className="space-y-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="font-semibold text-slate-700">
                  Product-Wise Commission Rates (%)
                </div>
                {newPolicy.productRates.map((pr, idx) => (
                  <div
                    key={pr.product}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="font-medium">{pr.product}</span>
                    <input
                      type="number"
                      value={pr.rate}
                      onChange={(e) => {
                        const copy = [...newPolicy.productRates];
                        copy[idx].rate = Number(e.target.value);
                        setNewPolicy({ ...newPolicy, productRates: copy });
                      }}
                      className="w-28 rounded-lg border border-slate-300 px-2.5 py-1"
                    />
                  </div>
                ))}
              </div>
            )}

            {newPolicy.model === "F" && (
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Referral Partner Commission (%)
                </label>
                <input
                  type="number"
                  value={newPolicy.referralRate}
                  onChange={(e) =>
                    setNewPolicy({
                      ...newPolicy,
                      referralRate: Number(e.target.value),
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
            )}

            {newPolicy.model === "G" && (
              <div className="space-y-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="font-semibold text-slate-700">
                  Multi-Level Pool Split (Must sum to 100%)
                </div>
                {newPolicy.multiLevelSplits.map((sp, idx) => (
                  <div
                    key={sp.role}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{sp.role}</span>
                    <input
                      type="number"
                      value={sp.share}
                      onChange={(e) => {
                        const copy = [...newPolicy.multiLevelSplits];
                        copy[idx].share = Number(e.target.value);
                        setNewPolicy({ ...newPolicy, multiLevelSplits: copy });
                      }}
                      className="w-28 rounded-lg border border-slate-300 px-2.5 py-1"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Eligible Employees / Teams
                </label>
                <input
                  value={newPolicy.eligibleGroup}
                  onChange={(e) =>
                    setNewPolicy({
                      ...newPolicy,
                      eligibleGroup: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Effective Start Date
                </label>
                <input
                  type="date"
                  value={newPolicy.effectiveFrom}
                  onChange={(e) =>
                    setNewPolicy({
                      ...newPolicy,
                      effectiveFrom: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Effective End Date
                </label>
                <input
                  type="date"
                  value={newPolicy.effectiveTo}
                  onChange={(e) =>
                    setNewPolicy({ ...newPolicy, effectiveTo: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Reversal & Clawback Rules
              </label>
              <input
                value={newPolicy.reversalRule}
                onChange={(e) =>
                  setNewPolicy({ ...newPolicy, reversalRule: e.target.value })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-blue-600 text-white font-bold"
              >
                {editingPolicyId ? "Save Changes" : "Save & Activate Policy"}
              </button>
            </div>
          </form>
        </div>
      )}

      <PolicyInsights policies={policies} />
    </div>
  );
}

// ============================================================================
// MODULE 4: SALES TRANSACTION MANAGEMENT (MANUAL + 7-STEP CSV/EXCEL WIZARD)
// ============================================================================
function ModuleTransactions({
  transactions,
  setTransactions,
  employees,
  departments,
  notify,
  me = null, // signed-in employee / partner record (null for admin)
}) {
  const [entryMode, setEntryMode] = useState("table");
  const [statusFilter, setStatusFilter] = useState("All");

  const [manual, setManual] = useState({
    invoiceNumber: me
      ? `INV${Date.now().toString().slice(-6)}`
      : `INV100${transactions.length + 1}`,
    customer: "",
    product: "",
    date: "13-11-2026",
    invoiceAmount: 100000,
    discount: 5000,
    salesperson: me ? me.name : "Rahul",
    department: me ? me.department || "Sales" : "Sales",
    // employees / partners enter sales as pending; an admin validates them
    status: me ? "Pending Validation" : "Validated",
  });
  const formEmployees = me ? [me] : employees;

  const [importType, setImportType] = useState("CSV");
  const [importStep, setImportStep] = useState(1);
  const [columnMap] = useState({
    invoiceCol: "Invoice_No",
    customerCol: "Client_Name",
    productCol: "SKU_Item",
    amountCol: "Gross_INR",
    discountCol: "Discount_INR",
    repCol: "Owner_Name",
  });
  const [stagedRows, setStagedRows] = useState([]);

  const statuses = [
    "Draft",
    "Imported",
    "Pending Validation",
    "Validated",
    "Eligible",
    "On Hold",
    "Cancelled",
    "Reversed",
  ];

  const handleManualSubmit = (e) => {
    e.preventDefault();
    const eligibleBase = Math.max(
      0,
      Number(manual.invoiceAmount) - Number(manual.discount),
    );
    const emp = me || employees.find((x) => x.name === manual.salesperson);
    const created = {
      // unique id (a scoped list is shorter than the real table, so a counter could clash)
      id: me
        ? `TXN${Date.now().toString(36).toUpperCase()}`
        : `TXN00${transactions.length + 1}`,
      ...manual,
      product: String(manual.product || "").trim(),
      invoiceAmount: Number(manual.invoiceAmount),
      discount: Number(manual.discount),
      eligibleBase,
      salespersonId: emp?.id || "EMP001",
      ...(me ? { salesperson: me.name, status: "Pending Validation" } : {}),
    };
    setTransactions((prev) => [created, ...prev]);
    setEntryMode("table");
    notify(
      `Transaction ${created.id} (${created.invoiceNumber}) saved with Eligible Base ${formatINR(eligibleBase)}.`,
    );
  };

  const loadSampleImport = (type) => {
    setImportType(type);
    const sample = [
      {
        rowNum: 1,
        invoiceNumber: "INV1007",
        customer: "Tata Digital Services",
        product: "Product B",
        date: "13-11-2026",
        invoiceAmount: 250000,
        discount: 10000,
        salesperson: "Rahul",
        department: "Sales",
        valid: true,
        error: "",
      },
      {
        rowNum: 2,
        invoiceNumber: "INV1001",
        customer: "ABC Customer",
        product: "Product A",
        date: "10-11-2026",
        invoiceAmount: 100000,
        discount: 5000,
        salesperson: "Rahul",
        department: "Sales",
        valid: false,
        error: "Duplicate Invoice Number (INV1001 already exists)",
      },
      {
        rowNum: 3,
        invoiceNumber: "INV1008",
        customer: "Reliance Retail Corp",
        product: "Product C",
        date: "13-11-2026",
        invoiceAmount: 300000,
        discount: 15000,
        salesperson: "Priya Sharma",
        department: "Enterprise",
        valid: true,
        error: "",
      },
    ];
    setStagedRows(sample);
    setImportStep(2);
  };

  const confirmImportRows = () => {
    const validOnes = stagedRows.filter((r) => r.valid);
    const mapped = validOnes.map((r, i) => ({
      id: `TXN00${transactions.length + i + 1}`,
      invoiceNumber: r.invoiceNumber,
      customer: r.customer,
      product: r.product,
      date: r.date,
      invoiceAmount: r.invoiceAmount,
      discount: r.discount,
      eligibleBase: r.invoiceAmount - r.discount,
      salesperson: r.salesperson,
      salespersonId: "EMP001",
      department: r.department,
      status: "Imported",
    }));
    setTransactions((prev) => [...mapped, ...prev]);
    setImportStep(1);
    setEntryMode("table");
    notify(
      `Imported ${mapped.length} valid ${importType} transaction(s); skipped ${stagedRows.length - mapped.length} duplicate row(s).`,
    );
  };

  const updateTxnStatus = (id, status) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status } : t)),
    );
    notify(`Transaction ${id} status changed to ${status}.`);
  };

  const displayed =
    statusFilter === "All"
      ? transactions
      : transactions.filter((t) => t.status === statusFilter);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setEntryMode("table")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${entryMode === "table"
              ? "bg-[#0A0A0B] text-white"
              : "bg-slate-100 text-slate-700"
              }`}
          >
            All Transactions ({transactions.length})
          </button>
          <button
            data-allow="employee user"
            onClick={() => setEntryMode("manual")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${entryMode === "manual"
              ? "bg-blue-600 text-white"
              : "bg-blue-50 text-blue-700"
              }`}
          >
            1. Manual Entry Form
          </button>
          <button
            onClick={() => {
              setEntryMode("import");
              setImportType("CSV");
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${entryMode === "import" && importType === "CSV"
              ? "bg-emerald-600 text-white"
              : "bg-emerald-50 text-emerald-700"
              }`}
          >
            2. CSV Import Wizard
          </button>
          <button
            onClick={() => {
              setEntryMode("import");
              setImportType("Excel");
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${entryMode === "import" && importType === "Excel"
              ? "bg-sky-600 text-white"
              : "bg-sky-50 text-sky-700"
              }`}
          >
            3. Excel (.xlsx) Import Wizard
          </button>
        </div>

        {entryMode === "table" && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold bg-white"
          >
            <option value="All">Filter Status: All</option>
            {statuses.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        )}
      </div>

      {entryMode === "manual" && (
        <form
          data-allow="employee user"
          onSubmit={handleManualSubmit}
          className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4 text-xs"
        >
          <h3 className="text-base font-bold text-slate-900">
            Manual Sales Transaction Entry
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Invoice Number *
              </label>
              <input
                required
                value={manual.invoiceNumber}
                onChange={(e) =>
                  setManual({ ...manual, invoiceNumber: e.target.value })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Customer Name *
              </label>
              <input
                required
                placeholder="e.g., ABC Customer"
                value={manual.customer}
                onChange={(e) =>
                  setManual({ ...manual, customer: e.target.value })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Product
              </label>
              <input
                required
                type="text"
                placeholder="Type product name, e.g., Product A"
                value={manual.product}
                onChange={(e) =>
                  setManual({ ...manual, product: e.target.value })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Transaction Date
              </label>
              <input
                value={manual.date}
                onChange={(e) => setManual({ ...manual, date: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Invoice Amount (₹)
              </label>
              <input
                type="number"
                value={manual.invoiceAmount}
                onChange={(e) =>
                  setManual({
                    ...manual,
                    invoiceAmount: Number(e.target.value),
                  })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Discount (₹)
              </label>
              <input
                type="number"
                value={manual.discount}
                onChange={(e) =>
                  setManual({ ...manual, discount: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Salesperson / Partner
              </label>
              <select
                value={manual.salesperson}
                onChange={(e) =>
                  setManual({ ...manual, salesperson: e.target.value })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
              >
                {formEmployees.map((e) => (
                  <option key={e.id} value={e.name}>
                    {e.name} ({e.id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Department
              </label>
              <select
                value={manual.department}
                onChange={(e) =>
                  setManual({ ...manual, department: e.target.value })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="text-[11px] font-semibold text-emerald-700">
                Auto-Computed Eligible Base
              </div>
              <div className="text-base font-extrabold text-emerald-900">
                {formatINR(Math.max(0, manual.invoiceAmount - manual.discount))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-blue-600 text-white font-bold"
            >
              Save Transaction Record
            </button>
          </div>
        </form>
      )}

      {entryMode === "import" && (
        <div
          className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">
              {importType} Bulk Sales Import Pipeline (7-Step Verification)
            </h3>
            <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
              {[
                "1. Upload File",
                "2. Map Columns",
                "3. Validate & Dedupe",
                "4. Preview & Confirm",
              ].map((s, idx) => (
                <span
                  key={s}
                  className={`px-2.5 py-1 rounded-lg ${importStep >= idx + 1
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-500"
                    }`}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          {importStep === 1 && (
            <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center space-y-3">
              <Upload className="w-8 h-8 text-blue-600 mx-auto" />
              <div className="text-sm font-bold text-slate-900">
                Upload your {importType} Sales File (
                {importType === "CSV" ? ".csv" : ".xlsx / .xls"})
              </div>
              <p className="text-slate-500 max-w-md mx-auto">
                System automatically maps columns, checks mandatory fields,
                detects duplicate invoice numbers, and previews valid vs.
                invalid rows.
              </p>
              <div className="flex justify-center gap-3 pt-2">
                <label className="cursor-pointer px-4 py-2 rounded-xl bg-[#0A0A0B] text-white font-bold">
                  Choose Local File
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={() => loadSampleImport(importType)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => loadSampleImport(importType)}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold"
                >
                  Load Sample {importType} Batch (3 Rows)
                </button>
              </div>
            </div>
          )}

          {importStep >= 2 && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-800 mb-2">
                  Step 2: Map {importType} Columns to System Fields
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(columnMap).map(([k, val]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-slate-200"
                    >
                      <span className="text-slate-500">
                        {k.replace("Col", "")}:
                      </span>
                      <span className="font-bold text-blue-700">{val} ✓</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="font-bold text-slate-800 mb-2">
                  Steps 3–6: Data Validation, Duplicate Detection & Row Preview
                </div>
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                      <tr>
                        <th className="whitespace-nowrap py-2.5 px-3">Row</th>
                        <th className="whitespace-nowrap py-2.5 px-3">
                          Invoice #
                        </th>
                        <th className="whitespace-nowrap py-2.5 px-3">
                          Customer
                        </th>
                        <th className="whitespace-nowrap py-2.5 px-3">
                          Product
                        </th>
                        <th className="whitespace-nowrap py-2.5 px-3 text-right">
                          Eligible Base
                        </th>
                        <th className="whitespace-nowrap py-2.5 px-3">
                          Salesperson
                        </th>
                        <th className="whitespace-nowrap py-2.5 px-3">
                          Validation Check
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {stagedRows.map((r) => (
                        <tr
                          key={r.rowNum}
                          className={r.valid ? "bg-white" : "bg-rose-50/70"}
                        >
                          <td className="whitespace-nowrap py-2.5 px-3 font-bold">
                            #{r.rowNum}
                          </td>
                          <td className="whitespace-nowrap py-2.5 px-3 font-semibold">
                            {r.invoiceNumber}
                          </td>
                          <td className="whitespace-nowrap py-2.5 px-3">
                            {r.customer}
                          </td>
                          <td className="whitespace-nowrap py-2.5 px-3">
                            {r.product}
                          </td>
                          <td className="whitespace-nowrap py-2.5 px-3 text-right font-semibold">
                            {formatINR(r.invoiceAmount - r.discount)}
                          </td>
                          <td className="whitespace-nowrap py-2.5 px-3">
                            {r.salesperson}
                          </td>
                          <td className="whitespace-nowrap py-2.5 px-3">
                            {r.valid ? (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                                Valid & Ready
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-semibold">
                                {r.error}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setImportStep(1)}
                  className="px-4 py-2 rounded-xl bg-slate-100 font-bold text-slate-700"
                >
                  Reset
                </button>
                <button
                  onClick={confirmImportRows}
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-bold"
                >
                  Step 7: Confirm Import & Save Valid Records
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {entryMode === "table" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                  <th className="whitespace-nowrap py-3.5 px-3">TXN ID</th>
                  <th className="whitespace-nowrap py-3.5 px-3">Invoice #</th>
                  <th className="whitespace-nowrap py-3.5 px-3">Customer</th>
                  <th className="whitespace-nowrap py-3.5 px-3">Product</th>
                  <th className="whitespace-nowrap py-3.5 px-3">Date</th>
                  <th className="whitespace-nowrap py-3.5 px-3 text-right">
                    Invoice Amt
                  </th>
                  <th className="whitespace-nowrap py-3.5 px-3 text-right">
                    Discount
                  </th>
                  <th className="whitespace-nowrap py-3.5 px-3 text-right">
                    Eligible Base
                  </th>
                  <th className="whitespace-nowrap py-3.5 px-3">Salesperson</th>
                  <th className="whitespace-nowrap py-3.5 px-3">Department</th>
                  <th className="whitespace-nowrap py-3.5 px-3">
                    Lifecycle Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayed.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/80">
                    <td className="whitespace-nowrap py-3 px-3 font-bold text-blue-600">
                      {t.id}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3 font-semibold text-slate-800">
                      {t.invoiceNumber}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3 font-medium">
                      {t.customer}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3">{t.product}</td>
                    <td className="whitespace-nowrap py-3 px-3 text-slate-500">
                      {t.date}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3 text-right">
                      {formatINR(t.invoiceAmount)}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3 text-right text-rose-600">
                      -{formatINR(t.discount)}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3 text-right font-extrabold text-slate-900">
                      {formatINR(t.eligibleBase)}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3 font-semibold">
                      {t.salesperson}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3 text-slate-600">
                      {t.department}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3">
                      <select
                        value={t.status}
                        onChange={(e) => updateTxnStatus(t.id, e.target.value)}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold bg-slate-50 min-w-[150px]"
                      >
                        {statuses.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MODULE 5: COMMISSION CALCULATION ENGINE
// ============================================================================
function ModuleCalculator({
  employees,
  policies,
  transactions,
  calcRuns,
  setCalcRuns,
  engine,
  setEngine,
  isPartner = false,
  canCalculate = true,
  notify,
}) {
  const [period, setPeriod] = useState("November 2026");
  const [targetScope, setTargetScope] = useState("ALL");
  const [running, setRunning] = useState(false);
  const [resultPopup, setResultPopup] = useState(null);
  const results = engine.results;
  const exceptions = engine.exceptions;

  // the calculation runs on the server (POST /api/engine/run) using the policies stored in PostgreSQL
  const runCalculation = async () => {
    setRunning(true);
    // popup opens immediately (processing), then flips to success / failed like a payment screen
    setResultPopup({ phase: "processing" });
    const minWait = new Promise((r) => setTimeout(r, 1400));
    try {
      const [out] = await Promise.all([
        api.post("/engine/run", { period, scope: targetScope }),
        minWait,
      ]);
      setEngine({ results: out.results, exceptions: out.exceptions });
      setCalcRuns((prev) => [out.run, ...prev]);
      setResultPopup({
        phase: "success",
        run: out.run,
        results: out.results,
        exceptions: out.exceptions,
      });
      notify(
        `Commission calculation completed! Total Calculated: ${formatINR(out.run.totalCommission)}.`,
      );
    } catch (err) {
      await minWait;
      setResultPopup({ phase: "failed", error: err.message || "Calculation failed" });
      notify(err.message, "error");
    }
    setRunning(false);
  };

  const [expandedEmp, setExpandedEmp] = useState({});
  const totalEligibleAll = results.reduce((s, r) => s + r.eligibleSales, 0);
  const totalCommAll = results.reduce((s, r) => s + r.calculatedCommission, 0);

  const BlockHeader = ({ num, title, subtitle, right }) => (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-3">
        <span className="w-8 h-8 rounded-xl bg-blue-600 text-white text-xs font-extrabold flex items-center justify-center shadow-sm">
          {num}
        </span>
        <div>
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* CALCULATION RESULT POPUP (PhonePe-style: processing -> success / failed) */}
      {resultPopup && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-4"
          style={{ animation: "cpFade .2s ease-out" }}
          onClick={() => resultPopup.phase !== "processing" && setResultPopup(null)}
        >
          <style>{`
            @keyframes cpFade { from { opacity: 0 } to { opacity: 1 } }
            @keyframes cpPop { 0% { opacity: 0; transform: scale(.8) translateY(30px) } 70% { transform: scale(1.03) } 100% { opacity: 1; transform: scale(1) } }
            @keyframes cpSpin { to { transform: rotate(360deg) } }
            @keyframes cpDraw { to { stroke-dashoffset: 0 } }
            @keyframes cpBounce { 0% { transform: scale(0) } 60% { transform: scale(1.18) } 100% { transform: scale(1) } }
            @keyframes cpRipple { 0% { transform: scale(.6); opacity: .7 } 100% { transform: scale(2.2); opacity: 0 } }
            @keyframes cpUp { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: translateY(0) } }
            @keyframes cpShake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-6px) } 75% { transform: translateX(6px) } }
          `}</style>

          {resultPopup.phase === "processing" && (
            <div
              className="bg-white rounded-3xl max-w-xs w-full shadow-2xl border border-slate-200 p-8 text-center"
              style={{ animation: "cpPop .35s ease-out" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="mx-auto w-16 h-16 rounded-full border-4 border-slate-200 border-t-blue-600"
                style={{ animation: "cpSpin .8s linear infinite" }}
              />
              <h3 className="mt-5 text-base font-extrabold text-slate-900">
                Calculating commission…
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Please wait, do not close this window.
              </p>
            </div>
          )}

          {resultPopup.phase === "failed" && (
            <div
              className="bg-white rounded-3xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden"
              style={{ animation: "cpPop .45s ease-out" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-b from-rose-500 to-rose-600 text-white px-6 py-8 text-center">
                <div
                  className="mx-auto w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg"
                  style={{ animation: "cpBounce .5s ease-out both, cpShake .5s .5s" }}
                >
                  <X className="w-9 h-9 text-rose-600" />
                </div>
                <h3 className="mt-3 text-lg font-extrabold">Calculation Failed</h3>
                <p className="text-xs text-rose-50 mt-1">{resultPopup.error}</p>
              </div>
              <div className="p-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResultPopup(null)}
                  className="px-5 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={runCalculation}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {resultPopup.phase === "success" && (
            <div
              className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col"
              style={{ animation: "cpPop .5s cubic-bezier(.2,.9,.3,1.2)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-b from-emerald-500 to-emerald-600 text-white px-6 pt-8 pb-6 text-center relative overflow-hidden">
                <button
                  type="button"
                  onClick={() => setResultPopup(null)}
                  className="absolute right-4 top-4 p-1.5 rounded-lg hover:bg-white/20 z-10"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="relative mx-auto w-20 h-20">
                  <span
                    className="absolute inset-0 rounded-full bg-white/40"
                    style={{ animation: "cpRipple 1.4s ease-out .3s 2" }}
                  />
                  <span
                    className="absolute inset-0 rounded-full bg-white/30"
                    style={{ animation: "cpRipple 1.4s ease-out .6s 2" }}
                  />
                  <div
                    className="relative w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-lg"
                    style={{ animation: "cpBounce .55s ease-out both" }}
                  >
                    <svg viewBox="0 0 52 52" className="w-12 h-12" fill="none">
                      <circle
                        cx="26" cy="26" r="23" stroke="#059669" strokeWidth="3"
                        strokeDasharray="145" strokeDashoffset="145"
                        style={{ animation: "cpDraw .6s ease-out .15s forwards" }}
                      />
                      <path
                        d="M15 27l8 8 15-17" stroke="#059669" strokeWidth="4"
                        strokeLinecap="round" strokeLinejoin="round"
                        strokeDasharray="40" strokeDashoffset="40"
                        style={{ animation: "cpDraw .4s ease-out .6s forwards" }}
                      />
                    </svg>
                  </div>
                </div>
                <h3
                  className="mt-4 text-lg font-extrabold"
                  style={{ animation: "cpUp .4s ease-out .7s both" }}
                >
                  Commission Calculated Successfully
                </h3>
                <div
                  className="text-3xl font-extrabold mt-1"
                  style={{ animation: "cpUp .4s ease-out .85s both" }}
                >
                  {formatINR(resultPopup.run.totalCommission)}
                </div>
                <div
                  className="text-[11px] text-emerald-50 mt-1"
                  style={{ animation: "cpUp .4s ease-out 1s both" }}
                >
                  {resultPopup.run.timestamp}
                </div>
              </div>

              <div
                className="p-5 space-y-4 overflow-y-auto text-xs"
                style={{ animation: "cpUp .45s ease-out 1s both" }}
              >
                <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                  {[
                    ["Run ID", resultPopup.run.runId],
                    ["Period", resultPopup.run.period],
                    ["Scope", resultPopup.run.scope],
                    ["People Calculated", resultPopup.results.length],
                    ["Total Eligible Sales", formatINR(resultPopup.run.totalSales)],
                    ["Total Commission", formatINR(resultPopup.run.totalCommission)],
                    ["Exceptions", resultPopup.exceptions.length],
                    ["Status", resultPopup.run.status],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="text-slate-500">{k}</span>
                      <span className="font-bold text-slate-900 text-right">{v}</span>
                    </div>
                  ))}
                </div>

                {resultPopup.results.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-bold uppercase text-slate-500 mb-2">
                      Commission per person
                    </h4>
                    <div className="space-y-2">
                      {resultPopup.results.map((r) => (
                        <div
                          key={r.employeeId}
                          className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 truncate">
                              {r.employeeName}{" "}
                              <span className="font-normal text-slate-400">({r.employeeId})</span>
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {r.policyName} • {r.txnCount} txns • Sales {formatINR(r.eligibleSales)}
                            </div>
                          </div>
                          <div className="font-extrabold text-emerald-700 whitespace-nowrap">
                            {formatINR(r.calculatedCommission)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {resultPopup.exceptions.length > 0 && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-800">
                    <div className="font-bold mb-1">
                      {resultPopup.exceptions.length} exception(s) excluded from the run
                    </div>
                    {resultPopup.exceptions.map((ex) => (
                      <div key={ex.id}>
                        • <strong>{ex.txnId}</strong> ({ex.employee}): {ex.issue}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="px-5 py-4 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => setResultPopup(null)}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BLOCK 1: RUN SETUP */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <BlockHeader
          num="1"
          title="Run Setup"
          subtitle="Choose the period and the people to calculate for"
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1 min-w-[280px]">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Calculation Period
              </label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-semibold bg-white"
              >
                <option>November 2026</option>
                <option>October 2026</option>
                <option>Q3 FY 2026-27</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Select Employee or Team
              </label>
              <select
                value={targetScope}
                onChange={(e) => setTargetScope(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-semibold bg-white"
              >
                <option value="ALL">All Employees & Partners</option>
                <option value="Sales">Team: Sales</option>
                <option value="Enterprise">Team: Enterprise</option>
                <option value="Channel Partners">Team: Channel Partners</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.id})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {canCalculate && (
            <button
              data-allow="user"
              onClick={runCalculation}
              disabled={running}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-2 shadow-sm"
            >
              <Calculator className="w-4 h-4" />{" "}
              {running ? "Calculating..." : "Calculate Commission"}
            </button>
            )}
            {canCalculate && (
            <button
              onClick={runCalculation}
              className="px-4 py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Request Recalculation
            </button>
            )}
          </div>
        </div>
      </div>

      {/* HOW THE ENGINE WORKS */}
      <EngineSteps />

      {/* POLICY REFERENCE */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <BlockHeader
          num="i"
          title="Policy Reference — how each plan pays"
          subtitle="Worked example: a ₹1,00,000 eligible sale under every policy"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {policies.map((p) => {
            let example = { commission: 0, breakdown: "" };
            try {
              example = computePolicyCommission(p, 100000, 1, "Product A");
            } catch (err) {
              /* ignore */
            }
            let rule = p.description;
            if (p.model === "A") rule = `${p.rate}% of eligible sales`;
            else if (p.model === "B")
              rule = `${formatINR(p.fixedAmount)} for every validated sale`;
            else if (p.model === "C" && p.slabs?.length)
              rule =
                `${p.tierMethod === "attainment" ? "Attainment tier" : "Marginal slabs"}: ` +
                p.slabs.map((sl) => `${sl.rate}%`).join(" → ");
            else if (p.model === "D")
              rule = `${formatINR(p.targetBonus)} bonus on reaching ${formatINR(p.targetAmount)}`;
            const users = employees.filter((e) => e.planId === p.id).length;
            return (
              <div
                key={p.id}
                className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {p.name}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {p.modelLabel} · {p.version}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${p.status === "Active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}
                  >
                    {p.status}
                  </span>
                </div>
                <div className="text-xs text-slate-700">
                  <span className="font-bold text-slate-900">Rule: </span>
                  {rule}
                </div>
                <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs space-y-1">
                  <div className="text-[10px] uppercase font-bold text-blue-700">
                    Example on ₹1,00,000
                  </div>
                  <div className="font-mono text-[11px] text-slate-700 break-words">
                    {example.breakdown}
                  </div>
                  <div className="text-sm font-extrabold text-blue-900">
                    → {formatINR(example.commission)} commission
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 mt-auto">
                  Assigned to{" "}
                  <strong className="text-slate-800">{users}</strong>{" "}
                  employee(s)/partner(s)
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* BLOCK 2: RUN SUMMARY */}
      {results.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <BlockHeader
            num="2"
            title="Run Summary"
            subtitle={`Overview for ${period}`}
          />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                label: "People Calculated",
                value: results.length,
                cls: "bg-blue-50 text-blue-800 border-blue-100",
              },
              {
                label: "Eligible Sales",
                value: formatINR(totalEligibleAll),
                cls: "bg-slate-50 text-slate-800 border-slate-200",
              },
              {
                label: "Total Commission",
                value: formatINR(totalCommAll),
                cls: "bg-emerald-50 text-emerald-800 border-emerald-100",
              },
              {
                label: "Exceptions",
                value: exceptions.length,
                cls: "bg-amber-50 text-amber-800 border-amber-100",
              },
            ].map((k) => (
              <div key={k.label} className={`rounded-xl border p-4 ${k.cls}`}>
                <div className="text-[11px] font-semibold uppercase opacity-70">
                  {k.label}
                </div>
                <div className="text-lg font-extrabold mt-1">{k.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BLOCK 3: EXCEPTIONS */}
      {exceptions.length > 0 && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-6 space-y-2">
          <BlockHeader
            num={results.length > 0 ? "3" : "2"}
            title={`Calculation Exceptions Detected (${exceptions.length})`}
            subtitle="These transactions are excluded from the payable run"
          />
          {exceptions.map((ex) => (
            <div key={ex.id} className="text-xs text-amber-800 pl-2">
              • <strong>{ex.txnId}</strong> ({ex.employee}): {ex.issue}
            </div>
          ))}
        </div>
      )}

      {/* BLOCK 4: RESULTS — ONE BLOCK PER PERSON (hidden for partners) */}
      {!isPartner && results.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <BlockHeader
            num="4"
            title="Calculation Results & Policy Breakdown"
            subtitle={`${period} — one block per employee / partner`}
          />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {results.map((r) => {
              const open = expandedEmp[r.employeeId] !== false;
              return (
                <div
                  key={r.employeeId}
                  className="rounded-2xl border border-slate-200 bg-slate-50/40 p-4 space-y-3 flex flex-col"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {r.employeeName}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {r.employeeId} • {r.department}
                      </div>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[11px] font-semibold text-right">
                      {r.policyName}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-white border border-slate-200 p-2.5">
                      <div className="text-[10px] uppercase text-slate-500 font-semibold">
                        Txns
                      </div>
                      <div className="text-sm font-bold text-slate-900">
                        {r.txnCount}
                      </div>
                    </div>
                    <div className="rounded-xl bg-white border border-slate-200 p-2.5">
                      <div className="text-[10px] uppercase text-slate-500 font-semibold">
                        Eligible Sales
                      </div>
                      <div className="text-sm font-bold text-slate-900">
                        {formatINR(r.eligibleSales)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-2.5">
                      <div className="text-[10px] uppercase text-emerald-700 font-semibold">
                        Commission
                      </div>
                      <div className="text-sm font-extrabold text-emerald-700">
                        {formatINR(r.calculatedCommission)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl bg-white border border-slate-200 p-3 text-xs space-y-2">
                    <div className="font-bold text-slate-800">
                      How this was calculated
                    </div>
                    <div className="flex gap-2 items-start">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        1
                      </span>
                      <span className="text-slate-700">
                        Took <strong>{r.txnCount}</strong> validated
                        transaction(s). After discounts, eligible sales ={" "}
                        <strong>{formatINR(r.eligibleSales)}</strong>
                      </span>
                    </div>
                    <div className="flex gap-2 items-start">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        2
                      </span>
                      <span className="text-slate-700">
                        Applied plan <strong>{r.policyName}</strong>:{" "}
                        <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">
                          {r.formulaSummary}
                        </span>
                      </span>
                    </div>
                    <div className="flex gap-2 items-start">
                      <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        3
                      </span>
                      <span className="text-slate-700">
                        Total commission ={" "}
                        <strong className="text-emerald-700">
                          {formatINR(r.calculatedCommission)}
                        </strong>{" "}
                        (
                        {r.eligibleSales
                          ? (
                            (r.calculatedCommission / r.eligibleSales) *
                            100
                          ).toFixed(2)
                          : "0.00"}
                        % effective rate)
                      </span>
                    </div>
                  </div>

                  {r.txnDetails.length > 0 && (
                    <div className="mt-auto">
                      <button
                        onClick={() =>
                          setExpandedEmp((p) => ({
                            ...p,
                            [r.employeeId]: !open,
                          }))
                        }
                        className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
                        />
                        {open ? "Hide" : "Show"} transaction breakdown (
                        {r.txnDetails.length})
                      </button>
                      {open && (
                        <div className="overflow-x-auto mt-2 bg-white rounded-xl border border-slate-200">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                                <th className="py-1.5 px-2">Transaction</th>
                                <th className="py-1.5 px-2">Product</th>
                                <th className="py-1.5 px-2 text-right">
                                  Eligible Base
                                </th>
                                <th className="py-1.5 px-2">
                                  Rule Computation
                                </th>
                                <th className="py-1.5 px-2 text-right">
                                  Line Commission
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {r.txnDetails.map((td) => (
                                <tr key={td.txnId}>
                                  <td className="py-1.5 px-2 font-bold text-blue-600">
                                    {td.txnId} ({td.invoice})
                                  </td>
                                  <td className="py-1.5 px-2">{td.product}</td>
                                  <td className="py-1.5 px-2 text-right">
                                    {formatINR(td.base)}
                                  </td>
                                  <td className="py-1.5 px-2 text-slate-600">
                                    {td.formula}
                                  </td>
                                  <td className="py-1.5 px-2 text-right font-bold text-slate-900">
                                    {formatINR(td.commission)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* BLOCK 5: RUN HISTORY */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <BlockHeader
          num="5"
          title="Calculation Run History"
          subtitle={canCalculate ? "All previous calculation runs" : "Your own calculations"}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase text-slate-500">
                <th className="py-2.5 px-3">Run ID</th>
                <th className="py-2.5 px-3">Period</th>
                <th className="py-2.5 px-3">Scope</th>
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3 text-right">Eligible Sales</th>
                <th className="py-2.5 px-3 text-right">Calculated Comm.</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(canCalculate
                ? calcRuns
                : (results || []).map((r) => ({
                  runId: r.employeeId,
                  period,
                  scope: r.policyName,
                  timestamp: "-",
                  totalSales: r.eligibleSales,
                  totalCommission: r.calculatedCommission,
                  status: "Calculated",
                }))
              ).map((run) => (
                <tr key={run.runId}>
                  <td className="py-2.5 px-3 font-bold text-blue-600">
                    {run.runId}
                  </td>
                  <td className="py-2.5 px-3 font-medium">{run.period}</td>
                  <td className="py-2.5 px-3">{run.scope}</td>
                  <td className="py-2.5 px-3 text-slate-500">
                    {run.timestamp}
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold">
                    {formatINR(run.totalSales)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                    {formatINR(run.totalCommission)}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                      {run.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MODULE 6: RETURNS, CANCELLATIONS & REVERSALS
// ============================================================================
function ModuleReversals({
  transactions,
  reversals,
  setReversals,
  notify,
}) {
  const [revForm, setRevForm] = useState({
    transactionId: "TXN001",
    type: "Partial Refund",
    originalCommission: 5000,
    refundAmount: 20000,
    reason: "",
  });

  const selectedTxn =
    transactions.find((t) => t.id === revForm.transactionId) || transactions[0];
  const effectiveRefund =
    revForm.type === "Full Refund" || revForm.type === "Cancellation"
      ? selectedTxn?.eligibleBase || 100000
      : Number(revForm.refundAmount);

  const computedReversed =
    selectedTxn && selectedTxn.eligibleBase > 0
      ? Math.round(
        (effectiveRefund / selectedTxn.eligibleBase) *
        Number(revForm.originalCommission),
      )
      : 0;
  const computedRemaining = Math.max(
    0,
    Number(revForm.originalCommission) - computedReversed,
  );

  const handleRecordReversal = (e) => {
    e.preventDefault();
    const record = {
      id: `REV00${reversals.length + 1}`,
      transactionId: selectedTxn.id,
      invoiceNumber: selectedTxn.invoiceNumber,
      employee: selectedTxn.salesperson,
      type: revForm.type,
      originalSales: selectedTxn.eligibleBase,
      originalCommission: Number(revForm.originalCommission),
      refundAmount: effectiveRefund,
      reversedCommission: computedReversed,
      remainingCommission: computedRemaining,
      date: "13-11-2026",
      reason: revForm.reason || `${revForm.type} recorded`,
      status: "Processed",
    };
    setReversals((prev) => [record, ...prev]);
    notify(
      `Recorded ${revForm.type} (${record.id}): Reversed ${formatINR(computedReversed)}.`,
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <h3 className="text-base font-bold text-slate-900 mb-3">
          Latest Commission Reversal Snapshot ({reversals[0]?.id} — Linked to{" "}
          {reversals[0]?.transactionId})
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-xs text-slate-500">Original Commission</div>
            <div className="text-xl font-extrabold text-slate-900 mt-1">
              {formatINR(reversals[0]?.originalCommission || 5000)}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
            <div className="text-xs text-amber-700">Refund Amount</div>
            <div className="text-xl font-extrabold text-amber-900 mt-1">
              {formatINR(reversals[0]?.refundAmount || 20000)}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200">
            <div className="text-xs text-rose-700">Reversed Commission</div>
            <div className="text-xl font-extrabold text-rose-800 mt-1">
              {formatINR(reversals[0]?.reversedCommission || 1000)}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
            <div className="text-xs text-emerald-700">Remaining Commission</div>
            <div className="text-xl font-extrabold text-emerald-900 mt-1">
              {formatINR(reversals[0]?.remainingCommission || 4000)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <form
          data-allow="employee user"
          onSubmit={handleRecordReversal}
          className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4 text-xs"
        >
          <h3 className="text-base font-bold text-slate-900">
            Record Full Refund, Partial Refund or Cancellation
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Link Original Transaction
              </label>
              <select
                value={revForm.transactionId}
                onChange={(e) =>
                  setRevForm({ ...revForm, transactionId: e.target.value })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
              >
                {transactions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id} ({t.invoiceNumber}) — {t.salesperson} (
                    {formatINR(t.eligibleBase)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Reversal Event Type
              </label>
              <select
                value={revForm.type}
                onChange={(e) =>
                  setRevForm({ ...revForm, type: e.target.value })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
              >
                <option>Partial Refund</option>
                <option>Full Refund</option>
                <option>Cancellation</option>
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Original Commission (₹)
              </label>
              <input
                type="number"
                value={revForm.originalCommission}
                onChange={(e) =>
                  setRevForm({
                    ...revForm,
                    originalCommission: Number(e.target.value),
                  })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Refund Amount (₹)
              </label>
              <input
                type="number"
                disabled={revForm.type !== "Partial Refund"}
                value={effectiveRefund}
                onChange={(e) =>
                  setRevForm({
                    ...revForm,
                    refundAmount: Number(e.target.value),
                  })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 disabled:bg-slate-100"
              />
            </div>
          </div>

          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex justify-between font-bold">
            <span className="text-rose-800">
              Auto-Calculated Reversal: -{formatINR(computedReversed)}
            </span>
            <span className="text-emerald-800">
              Remaining: {formatINR(computedRemaining)}
            </span>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Reason / Credit Note Reference
            </label>
            <input
              required
              placeholder="e.g., Credit Note CN-409 issued for partial return"
              value={revForm.reason}
              onChange={(e) =>
                setRevForm({ ...revForm, reason: e.target.value })
              }
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
            />
          </div>

          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-rose-600 text-white font-bold"
          >
            Calculate & Record Commission Reversal
          </button>
        </form>

      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <h3 className="text-base font-bold text-slate-900 mb-3">
          Reversal & Clawback History
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase text-slate-500">
                <th className="py-2.5 px-3">Reversal ID</th>
                <th className="py-2.5 px-3">Original TXN</th>
                <th className="py-2.5 px-3">Employee</th>
                <th className="py-2.5 px-3">Event Type</th>
                <th className="py-2.5 px-3 text-right">Original Comm.</th>
                <th className="py-2.5 px-3 text-right">Refund Amt</th>
                <th className="py-2.5 px-3 text-right">Reversed Comm.</th>
                <th className="py-2.5 px-3 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reversals.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5 px-3 font-bold text-rose-600">
                    {r.id}
                  </td>
                  <td className="py-2.5 px-3 font-semibold">
                    {r.transactionId} ({r.invoiceNumber})
                  </td>
                  <td className="py-2.5 px-3 font-medium">{r.employee}</td>
                  <td className="py-2.5 px-3">{r.type}</td>
                  <td className="py-2.5 px-3 text-right">
                    {formatINR(r.originalCommission)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {formatINR(r.refundAmount)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-rose-700">
                    -{formatINR(r.reversedCommission)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                    {formatINR(r.remainingCommission)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MODULE 8: COMMISSION STATEMENTS
// ============================================================================
function ModuleStatements({
  org,
  statements,
  setStatements,
  transactions,
  employees = [],
  policies = [],
  notify,
}) {
  const [selectedStmt, setSelectedStmt] = useState(statements[0]);
  const [genEmpId, setGenEmpId] = useState(employees[0]?.id || "");
  const [previewOpen, setPreviewOpen] = useState(false);

  const generateMonthlyStatement = () => {
    const emp = employees.find((e) => e.id === genEmpId);
    if (!emp) {
      notify("Select an employee first.", "error");
      return;
    }
    const policy = policies.find((p) => p.id === emp.planId) || policies[0];
    const empTxns = transactions.filter(
      (t) =>
        (t.salesperson === emp.name || t.referrer === emp.name) &&
        (t.status === "Validated" || t.status === "Eligible"),
    );
    if (empTxns.length === 0) {
      notify(
        `No validated transactions found for ${emp.name} — nothing to generate.`,
        "error",
      );
      return;
    }
    const eligible = empTxns.reduce((sum, t) => sum + t.eligibleBase, 0);
    const res =
      policy.model === "C" || policy.model === "D"
        ? computePolicyCommission(policy, eligible, empTxns.length)
        : {
          commission: empTxns.reduce(
            (sum, t) =>
              sum +
              computePolicyCommission(policy, t.eligibleBase, 1, t.product)
                .commission,
            0,
          ),
        };
    const gross = Math.round(res.commission);
    const newId = `STMT${String(statements.length + 1).padStart(3, "0")}`;
    const created = {
      id: newId,
      employeeId: emp.id,
      employee: emp.name,
      department: emp.department,
      period: "November 2026",
      eligibleSales: eligible,
      commissionRate:
        policy.model === "A" ? `${policy.rate}%` : policy.modelLabel,
      policyApplied: `${policy.name} (${policy.version})`,
      grossCommission: gross,
      reversals: 0,
      adjustments: 0,
      deductions: 0,
      netPayable: gross,
      submittedDate: new Date().toLocaleDateString("en-GB").replace(/\//g, "-"),
      status: "Draft",
      locked: false,
      comments: [],
    };
    setStatements((prev) => [created, ...prev]);
    setSelectedStmt(created);
    notify(`Generated monthly statement ${newId} for ${emp.name}.`);
  };

  const submitForApproval = (stmt) => {
    if (stmt.locked) {
      notify(
        "Statement is finalised & locked and cannot be modified.",
        "error",
      );
      return;
    }
    setStatements((prev) =>
      prev.map((s) =>
        s.id === stmt.id ? { ...s, status: "Pending Approval" } : s,
      ),
    );
    setSelectedStmt((prev) => ({ ...prev, status: "Pending Approval" }));
    notify(`Statement ${stmt.id} submitted to Approval Workflow.`);
  };

  const toggleLockStatement = (stmt) => {
    const nextLock = !stmt.locked;
    setStatements((prev) =>
      prev.map((s) =>
        s.id === stmt.id
          ? {
            ...s,
            locked: nextLock,
            status: nextLock ? "Finalised & Locked" : "Approved",
          }
          : s,
      ),
    );
    setSelectedStmt((prev) => ({
      ...prev,
      locked: nextLock,
      status: nextLock ? "Finalised & Locked" : "Approved",
    }));
    notify(
      nextLock
        ? `Statement ${stmt.id} locked after finalisation.`
        : `Statement ${stmt.id} unlocked for authorised review.`,
    );
  };

  const exportStatementCSV = (stmt) => {
    downloadCSV(
      `${stmt.id}_${stmt.employee}.csv`,
      [
        "Statement ID",
        "Employee",
        "Period",
        "Eligible Sales",
        "Rate",
        "Gross",
        "Reversals",
        "Adjustments",
        "Deductions",
        "Net Payable",
        "Status",
      ],
      [
        [
          stmt.id,
          stmt.employee,
          stmt.period,
          stmt.eligibleSales,
          stmt.commissionRate,
          stmt.grossCommission,
          stmt.reversals,
          stmt.adjustments,
          stmt.deductions,
          stmt.netPayable,
          stmt.status,
        ],
      ],
    );
    notify(`Exported ${stmt.id} to CSV/Excel.`);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Commission Statements & Calculation Audit
          </h2>
          <p className="text-xs text-slate-500">
            Transparent line-by-line breakdown showing exact earnings,
            reversals, adjustments, deductions, and net payable.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={genEmpId}
            onChange={(e) => setGenEmpId(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2.5 text-xs font-semibold bg-white"
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.id})
              </option>
            ))}
          </select>
          <button
            onClick={generateMonthlyStatement}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> Generate Monthly Statement
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <h3 className="text-sm font-bold text-slate-900">
            Statement History
          </h3>
          {statements.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelectedStmt(s)}
              className={`cursor-pointer p-3.5 rounded-xl border transition ${selectedStmt?.id === s.id
                ? "border-blue-600 bg-blue-50/60"
                : "border-slate-200 hover:bg-slate-50"
                }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-700">
                  {s.id} • {s.employee}
                </span>
                {s.locked && <Lock className="w-3.5 h-3.5 text-slate-600" />}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {s.period} • {s.policyApplied}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm font-extrabold text-slate-900">
                  {formatINR(s.netPayable)}
                </span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-800">
                  {s.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        {selectedStmt && (
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-blue-100 text-blue-800">
                    {selectedStmt.id}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    {selectedStmt.period}
                  </span>
                  {selectedStmt.locked && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#0A0A0B] text-white">
                      <Lock className="w-3 h-3" /> Locked
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-extrabold text-slate-900 mt-1">
                  {selectedStmt.employee} — Commission Statement
                </h3>
                <p className="text-xs text-slate-500">
                  Policy Applied: {selectedStmt.policyApplied}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setPreviewOpen(true)}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 flex items-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5" /> Preview / PDF
                </button>
                <button
                  onClick={() => exportStatementCSV(selectedStmt)}
                  className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Export Excel/CSV
                </button>
                {!selectedStmt.locked && selectedStmt.status === "Draft" && (
                  <button
                    onClick={() => submitForApproval(selectedStmt)}
                    className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold"
                  >
                    Submit for Approval
                  </button>
                )}
                <button
                  onClick={() => toggleLockStatement(selectedStmt)}
                  className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 flex items-center gap-1"
                >
                  {selectedStmt.locked ? (
                    <Unlock className="w-3.5 h-3.5" />
                  ) : (
                    <Lock className="w-3.5 h-3.5" />
                  )}
                  {selectedStmt.locked ? "Unlock" : "Lock Final"}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">Calculation Component</th>
                    <th className="py-2.5 px-4">Audit Explanation</th>
                    <th className="py-2.5 px-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-800">
                      Eligible Sales
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      Validated net invoice revenue after discounts
                    </td>
                    <td className="py-3 px-4 text-right font-bold">
                      {formatINR(selectedStmt.eligibleSales)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-800">
                      Commission Rate
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {selectedStmt.policyApplied}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-blue-600">
                      {selectedStmt.commissionRate}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-800">
                      Gross Commission
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      Eligible sales × applicable policy rate
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-slate-900">
                      {formatINR(selectedStmt.grossCommission)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-rose-700">
                      Reversals
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      Clawback from partial/full customer refunds
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-rose-700">
                      -{formatINR(selectedStmt.reversals)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-emerald-700">
                      Adjustments
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      Authorised SPIFF / manual credit adjustments
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-700">
                      +{formatINR(selectedStmt.adjustments)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-800">
                      Deductions
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      Statutory / advance recoveries
                    </td>
                    <td className="py-3 px-4 text-right font-semibold">
                      {formatINR(selectedStmt.deductions)}
                    </td>
                  </tr>
                  <tr className="bg-blue-50/80">
                    <td className="py-3.5 px-4 font-extrabold text-blue-950 text-sm">
                      Net Payable
                    </td>
                    <td className="py-3.5 px-4 text-blue-800 font-medium">
                      Gross ({formatINR(selectedStmt.grossCommission)}) −
                      Reversals ({formatINR(selectedStmt.reversals)}) +
                      Adjustments ({formatINR(selectedStmt.adjustments)})
                    </td>
                    <td className="py-3.5 px-4 text-right font-extrabold text-blue-950 text-base">
                      {formatINR(selectedStmt.netPayable)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <StatementCalcDetail
              stmt={selectedStmt}
              employees={employees}
              policies={policies}
              transactions={transactions}
            />

            <div>
              <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">
                Included Sales Transactions
              </h4>
              <div className="space-y-1.5 text-xs">
                {transactions
                  .filter((t) => t.salesperson === selectedStmt.employee)
                  .map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/80"
                    >
                      <span>
                        <strong className="text-blue-600">{t.id}</strong> (
                        {t.invoiceNumber}) — {t.customer} • {t.product}
                      </span>
                      <span className="font-bold">
                        {formatINR(t.eligibleBase)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {previewOpen && selectedStmt && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-8 shadow-2xl space-y-5">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <div className="text-xs font-bold uppercase text-blue-600">
                  {org.name}
                </div>
                <h3 className="text-xl font-extrabold text-slate-900">
                  Official Commission Statement ({selectedStmt.id})
                </h3>
                <p className="text-xs text-slate-500">
                  {org.address} • GSTIN: {org.gstin}
                </p>
              </div>
              <button onClick={() => setPreviewOpen(false)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-xl">
              <div>
                <strong>Employee:</strong> {selectedStmt.employee} (
                {selectedStmt.employeeId})
              </div>
              <div>
                <strong>Period:</strong> {selectedStmt.period}
              </div>
              <div>
                <strong>Department:</strong> {selectedStmt.department}
              </div>
              <div>
                <strong>Status:</strong> {selectedStmt.status}
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b">
                <span>Eligible Sales</span>
                <strong>{formatINR(selectedStmt.eligibleSales)}</strong>
              </div>
              <div className="flex justify-between py-1.5 border-b">
                <span>Commission Rate</span>
                <strong>{selectedStmt.commissionRate}</strong>
              </div>
              <div className="flex justify-between py-1.5 border-b">
                <span>Gross Commission</span>
                <strong>{formatINR(selectedStmt.grossCommission)}</strong>
              </div>
              <div className="flex justify-between py-1.5 border-b text-rose-700">
                <span>Reversals</span>
                <strong>-{formatINR(selectedStmt.reversals)}</strong>
              </div>
              <div className="flex justify-between py-1.5 border-b text-emerald-700">
                <span>Adjustments</span>
                <strong>+{formatINR(selectedStmt.adjustments)}</strong>
              </div>
              <div className="flex justify-between py-1.5 border-b">
                <span>Deductions</span>
                <strong>{formatINR(selectedStmt.deductions)}</strong>
              </div>
              <div className="flex justify-between py-2.5 text-base font-extrabold text-blue-950 bg-blue-50 px-3 rounded-lg">
                <span>Net Payable</span>
                <span>{formatINR(selectedStmt.netPayable)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  window.print();
                  notify("Print / Save as PDF dialog opened.");
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" /> Download / Print PDF
              </button>
              <button
                onClick={() => setPreviewOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MODULE 9: APPROVAL WORKFLOW
// ============================================================================
function ModuleApprovals({
  statements,
  setStatements,
  payouts,
  setPayouts,
  transactionsTotal = 0,
  accessLevel = "admin",
  currentUserName = "",
  notify,
}) {
  const [noteModal, setNoteModal] = useState(null); // statement the person is writing a comment on
  const [noteText, setNoteText] = useState("");
  const canNote = accessLevel === "admin" || accessLevel === "employee";
  const submitNote = (e) => {
    e.preventDefault();
    if (!noteModal || !noteText.trim()) return;
    const author =
      accessLevel === "employee"
        ? currentUserName
        : `${currentUserName || "Admin"} (Admin)`;
    setStatements((prev) =>
      prev.map((s) =>
        s.id === noteModal.id
          ? {
            ...s,
            comments: [
              ...(s.comments || []),
              {
                author,
                text: noteText.trim(),
                date: new Date().toLocaleString("en-IN"),
              },
            ],
          }
          : s,
      ),
    );
    notify(`Comment added to ${noteModal.id}.`);
    setNoteModal(null);
    setNoteText("");
  };
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [commentText, setCommentText] = useState("");
  const [historyStmt, setHistoryStmt] = useState(null);

  const workflowStages = [
    "1. Transactions Imported",
    "2. Commission Calculated",
    "3. Finance Reviews Exceptions",
    "4. Manager Reviews Team",
    "5. Approver Signs Off Batch",
    "6. Statements Finalised",
    "7. Payout Records Created",
  ];

  const handleApprove = (stmt) => {
    setStatements((prev) =>
      prev.map((s) =>
        s.id === stmt.id
          ? {
            ...s,
            status: "Approved",
            locked: true,
            comments: [
              ...(s.comments || []),
              {
                author: "Kavita Deshmukh (Approver)",
                text:
                  commentText ||
                  "Approved & finalised. Statement locked and payout record generated.",
                date: new Date().toLocaleString("en-IN"),
              },
            ],
          }
          : s,
      ),
    );

    if (!payouts.some((p) => p.statementId === stmt.id)) {
      setPayouts((prev) => [
        ...prev,
        {
          id: `PAY00${prev.length + 1}`,
          batchId: "BATCH-NOV-03",
          statementId: stmt.id,
          employee: stmt.employee,
          approvedAmount: stmt.netPayable,
          bankPaidAmount: 0,
          paymentDate: "18-11-2026",
          paymentMethod: "Bank Transfer",
          referenceNumber: `UTR-PEND-${prev.length + 1}`,
          status: "Scheduled",
        },
      ]);
    }
    setCommentText("");
    notify(
      `Statement ${stmt.id} (${stmt.employee}) Approved, Finalised & Locked! Payout record created.`,
    );
  };

  const handleRejectSubmit = (e) => {
    e.preventDefault();
    if (!rejectModal) return;
    setStatements((prev) =>
      prev.map((s) =>
        s.id === rejectModal.id
          ? {
            ...s,
            status: "Rejected",
            comments: [
              ...(s.comments || []),
              {
                author: "Kavita Deshmukh (Approver)",
                text: `REJECTED: ${rejectReason}`,
                date: new Date().toLocaleString("en-IN"),
              },
            ],
          }
          : s,
      ),
    );
    notify(`Statement ${rejectModal.id} rejected with reason logged.`, "error");
    setRejectModal(null);
    setRejectReason("");
  };

  return (
    <div className="space-y-6">
      {(() => {
        const pendingCount = statements.filter(
          (x) =>
            !x.locked && x.status !== "Approved" && x.status !== "Rejected",
        ).length;
        const rejectedCount = statements.filter(
          (x) => x.status === "Rejected",
        ).length;
        const lockedCount = statements.filter(
          (x) => x.locked || x.status === "Approved",
        ).length;
        const stageMeta = [
          {
            icon: FileSpreadsheet,
            title: "Transactions Imported",
            owner: "Sales Ops",
            note: `${transactionsTotal} records`,
          },
          {
            icon: Calculator,
            title: "Commission Calculated",
            owner: "Commission Engine",
            note: "Auto-run complete",
          },
          {
            icon: AlertTriangle,
            title: "Finance Reviews Exceptions",
            owner: "Finance",
            note: "Exceptions cleared",
          },
          {
            icon: Users,
            title: "Manager Reviews Team",
            owner: "Sales Managers",
            note: "Team verified",
          },
          {
            icon: ShieldCheck,
            title: "Approver Signs Off Batch",
            owner: "Approver",
            note:
              pendingCount > 0
                ? `${pendingCount} awaiting sign-off`
                : "All signed off",
          },
          {
            icon: Lock,
            title: "Statements Finalised",
            owner: "System",
            note: `${lockedCount} locked`,
          },
          {
            icon: Wallet,
            title: "Payout Records Created",
            owner: "Finance",
            note: `${payouts.length} payouts`,
          },
        ];
        const stateOf = (i) => {
          if (i < 4) return "done";
          if (i === 4) return pendingCount > 0 ? "active" : "done";
          if (i === 5) return lockedCount > 0 ? "done" : "todo";
          return payouts.length > 0 ? "done" : "todo";
        };
        const states = stageMeta.map((_, i) => stateOf(i));
        const doneN = states.filter((x) => x === "done").length;
        const pct = Math.round((doneN / 7) * 100);
        return (
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-blue-50/60 p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                  Enterprise Governance
                </div>
                <h3 className="text-lg font-extrabold text-slate-900">
                  7-Stage Approval Pipeline
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex gap-2 text-[11px] font-bold">
                  <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">
                    {pendingCount} pending
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
                    {lockedCount} approved
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-800">
                    {rejectedCount} rejected
                  </span>
                </div>
                <div className="relative w-14 h-14">
                  <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      stroke="#E4E4E7"
                      strokeWidth="3.5"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      stroke="#10B981"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeDasharray={`${pct * 0.974} 100`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] font-extrabold text-slate-900">
                    {pct}%
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto pb-2">
              <div className="relative min-w-[860px]">
                <div className="absolute top-7 left-[7%] right-[7%] h-1.5 rounded-full bg-slate-200" />
                <div
                  className="absolute top-7 left-[7%] h-1.5 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-700"
                  style={{
                    width: `${Math.max(0, (Math.min(doneN, 6) / 6) * 86)}%`,
                  }}
                />
                <div className="relative grid grid-cols-7 gap-2">
                  {stageMeta.map((st, i) => {
                    const Icon = st.icon;
                    const state = states[i];
                    return (
                      <div
                        key={st.title}
                        className="flex flex-col items-center text-center px-1"
                      >
                        <div className="relative">
                          {state === "active" && (
                            <span className="absolute inset-0 rounded-2xl bg-blue-400/50 animate-ping" />
                          )}
                          <div
                            className={`relative w-14 h-14 rounded-2xl flex items-center justify-center shadow-md border-2 ${state === "done"
                              ? "bg-gradient-to-br from-emerald-400 to-emerald-600 border-white text-white"
                              : state === "active"
                                ? "bg-gradient-to-br from-blue-500 to-indigo-600 border-white text-white ring-4 ring-blue-200"
                                : "bg-white border-slate-200 text-slate-400"
                              }`}
                          >
                            {state === "done" ? (
                              <Check className="w-6 h-6" strokeWidth={3} />
                            ) : (
                              <Icon className="w-6 h-6" />
                            )}
                          </div>
                          <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-extrabold flex items-center justify-center border-2 border-white">
                            {i + 1}
                          </span>
                        </div>
                        <div className="mt-3 text-[11px] font-bold text-slate-900 leading-tight">
                          {st.title}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {st.owner}
                        </div>
                        <span
                          className={`mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${state === "done"
                            ? "bg-emerald-100 text-emerald-800"
                            : state === "active"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-100 text-slate-500"
                            }`}
                        >
                          {state === "active"
                            ? "In progress"
                            : state === "done"
                              ? st.note
                              : "Waiting"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="p-3.5 rounded-xl bg-[#0A0A0B] text-slate-200 text-xs flex items-center gap-2.5">
        <Lock className="w-4 h-4 text-amber-400 shrink-0" />
        <span>
          <strong>Governance Control:</strong> Approved and finalised statements
          are automatically locked against direct editing. Post-approval
          corrections must be routed through authorised Adjustments or
          Reversals.
        </span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900">
            Statement Approval Queue
          </h3>
          {accessLevel === "admin" && (
            <input
              type="text"
              placeholder="Optional approval comment before clicking Approve..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs w-72"
            />
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                <th className="whitespace-nowrap py-3 px-4">Employee</th>
                <th className="whitespace-nowrap py-3 px-4">Statement ID</th>
                <th className="whitespace-nowrap py-3 px-4 text-right">
                  Commission
                </th>
                <th className="whitespace-nowrap py-3 px-4">Submitted Date</th>
                <th className="whitespace-nowrap py-3 px-4">Status</th>
                <th className="whitespace-nowrap py-3 px-4 text-right">
                  Approval Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {statements.map((st) => (
                <tr key={st.id} className="hover:bg-slate-50/80">
                  <td className="whitespace-nowrap py-3.5 px-4 font-bold text-slate-900">
                    {st.employee}
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-4 font-bold text-blue-600">
                    {st.id}
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-4 text-right font-extrabold text-slate-900">
                    {formatINR(st.netPayable)}
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-4 text-slate-500">
                    {st.submittedDate}
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-4">
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-semibold ${st.status === "Approved" ||
                        st.status === "Finalised & Locked"
                        ? "bg-emerald-100 text-emerald-800"
                        : st.status === "Rejected"
                          ? "bg-rose-100 text-rose-800"
                          : "bg-amber-100 text-amber-800"
                        }`}
                    >
                      {st.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-3.5 px-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      {!st.locked && st.status !== "Approved" && (
                        <>
                          <button
                            onClick={() => handleApprove(st)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setRejectModal(st)}
                            className="px-3 py-1.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {canNote && (
                        <button
                          data-allow="employee"
                          onClick={() => {
                            setNoteModal(st);
                            setNoteText("");
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold"
                        >
                          Edit / add comment
                        </button>
                      )}
                      <button
                        onClick={() => setHistoryStmt(st)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-semibold"
                      >
                        History ({st.comments?.length || 0})
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {noteModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
          <form
            data-allow="employee"
            onSubmit={submitNote}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 text-xs border border-red-900/40"
          >
            <h3 className="text-base font-bold text-slate-900">
              Add a comment — {noteModal.id} ({noteModal.employee})
            </h3>
            <p className="text-slate-500">
              Your note is added to the approval history of this statement.
              Amounts and status cannot be changed here.
            </p>
            <textarea
              required
              rows={4}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Write your comment or query for the approver…"
              className="w-full rounded-xl border border-slate-300 p-3"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNoteModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold"
              >
                Save comment
              </button>
            </div>
          </form>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleRejectSubmit}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <h3 className="text-base font-bold text-slate-900">
              Reject Statement {rejectModal.id} ({rejectModal.employee})
            </h3>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Mandatory Rejection Reason *
              </label>
              <textarea
                required
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Specify discrepancy or exception requiring recalculation..."
                className="w-full rounded-xl border border-slate-300 p-3"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold"
              >
                Confirm Rejection
              </button>
            </div>
          </form>
        </div>
      )}

      {historyStmt &&
        (() => {
          const hs =
            statements.find((x) => x.id === historyStmt.id) || historyStmt;
          const events = hs.comments || [];
          const isApproved =
            hs.status === "Approved" || hs.status === "Finalised & Locked";
          const isRejected = hs.status === "Rejected";
          const doneCount = isApproved ? 7 : isRejected ? 3 : 5;
          const kindOf = (t = "") =>
            /^REJECTED/i.test(t)
              ? "reject"
              : /approv|finalis|lock/i.test(t)
                ? "approve"
                : "note";
          const style = {
            approve: {
              dot: "bg-emerald-500",
              chip: "bg-emerald-100 text-emerald-800",
              label: "Approved",
            },
            reject: {
              dot: "bg-rose-500",
              chip: "bg-rose-100 text-rose-800",
              label: "Rejected",
            },
            note: {
              dot: "bg-blue-500",
              chip: "bg-blue-100 text-blue-800",
              label: "Comment",
            },
          };
          const initials = (n = "") =>
            n
              .split(" ")
              .slice(0, 2)
              .map((w) => w[0])
              .join("")
              .toUpperCase();
          return (
            <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl text-xs overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3 bg-slate-50">
                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-blue-600">
                      <History className="w-3.5 h-3.5" /> Approval Audit Trail
                    </div>
                    <h3 className="text-base font-extrabold text-slate-900 mt-0.5">
                      {hs.id} · {hs.employee}
                    </h3>
                    <div className="text-slate-500 mt-0.5">
                      Net payable{" "}
                      <strong className="text-slate-800">
                        {formatINR(hs.netPayable)}
                      </strong>{" "}
                      · Submitted {hs.submittedDate}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-full font-bold whitespace-nowrap ${isApproved ? "bg-emerald-100 text-emerald-800" : isRejected ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}
                    >
                      {hs.status}
                    </span>
                    <button
                      onClick={() => setHistoryStmt(null)}
                      className="p-1.5 rounded-lg hover:bg-slate-200"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="px-5 pt-4">
                  <div className="flex items-center gap-1">
                    {workflowStages.map((st, i) => (
                      <div key={st} className="flex-1" title={st}>
                        <div
                          className={`h-1.5 rounded-full ${i < doneCount ? (isRejected && i === 2 ? "bg-rose-500" : "bg-emerald-500") : "bg-slate-200"}`}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1.5">
                    <span>Stage {Math.min(doneCount, 7)} of 7</span>
                    <span>
                      {isApproved
                        ? "Completed & locked"
                        : isRejected
                          ? "Sent back for recalculation"
                          : "Awaiting approver sign-off"}
                    </span>
                  </div>
                </div>

                <div className="p-5 overflow-y-auto space-y-6">
                  <div>
                    <div className="text-[11px] font-bold uppercase text-slate-500 mb-2">
                      Statement Details
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {[
                        ["Employee", hs.employee],
                        ["Employee ID", hs.employeeId],
                        ["Department", hs.department],
                        ["Period", hs.period],
                        ["Policy Applied", hs.policyApplied],
                        ["Commission Rate", hs.commissionRate],
                        ["Eligible Sales", formatINR(hs.eligibleSales)],
                        ["Submitted On", hs.submittedDate],
                        ["Lock Status", hs.locked ? "Locked" : "Editable"],
                      ].map(([k, v]) => (
                        <div
                          key={k}
                          className="rounded-xl bg-slate-50 border border-slate-200 p-2.5"
                        >
                          <div className="text-[10px] uppercase font-semibold text-slate-500">
                            {k}
                          </div>
                          <div className="font-bold text-slate-900 mt-0.5 break-words">
                            {v ?? "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden">
                      {[
                        [
                          "Gross Commission",
                          formatINR(hs.grossCommission),
                          "text-slate-900",
                        ],
                        [
                          "− Reversals",
                          formatINR(hs.reversals),
                          "text-rose-600",
                        ],
                        [
                          "+ Adjustments",
                          formatINR(hs.adjustments),
                          "text-emerald-600",
                        ],
                        [
                          "− Deductions",
                          formatINR(hs.deductions),
                          "text-rose-600",
                        ],
                      ].map(([k, v, c]) => (
                        <div
                          key={k}
                          className="flex justify-between px-3.5 py-2 border-b border-slate-100"
                        >
                          <span className="text-slate-600">{k}</span>
                          <span className={`font-semibold ${c}`}>{v}</span>
                        </div>
                      ))}
                      <div className="flex justify-between px-3.5 py-2.5 bg-[#0A0A0B] text-white font-extrabold">
                        <span>Net Payable</span>
                        <span>{formatINR(hs.netPayable)}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-bold uppercase text-slate-500 mb-3">
                      Approval Timeline ({events.length})
                    </div>
                    {events.length === 0 ? (
                      <div className="text-center py-8 text-slate-500">
                        <History className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                        No actions logged yet for this statement.
                      </div>
                    ) : (
                      <ol className="relative border-l-2 border-slate-200 ml-3 space-y-5">
                        {events.map((c, i) => {
                          const k = kindOf(c.text);
                          const st = style[k];
                          return (
                            <li key={i} className="ml-6 relative">
                              <span
                                className={`absolute -left-[33px] top-0.5 w-5 h-5 rounded-full ring-4 ring-white ${st.dot} flex items-center justify-center`}
                              >
                                {k === "approve" ? (
                                  <Check className="w-3 h-3 text-white" />
                                ) : k === "reject" ? (
                                  <X className="w-3 h-3 text-white" />
                                ) : (
                                  <MessageSquare className="w-2.5 h-2.5 text-white" />
                                )}
                              </span>
                              <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="w-6 h-6 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center">
                                      {initials(c.author)}
                                    </span>
                                    <span className="font-bold text-slate-900">
                                      {c.author}
                                    </span>
                                  </div>
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${st.chip}`}
                                  >
                                    {st.label}
                                  </span>
                                </div>
                                <p className="mt-2 text-slate-700 leading-relaxed">
                                  {c.text}
                                </p>
                                <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3" /> {c.date}
                                  {i === events.length - 1 && (
                                    <span className="ml-auto text-blue-600 font-bold">
                                      Latest
                                    </span>
                                  )}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

// ============================================================================
// MODULE 10: PAYOUT TRACKING & BANK RECONCILIATION
// ============================================================================
function ModulePayouts({ payouts, setPayouts, notify }) {
  const [batchModal, setBatchModal] = useState(false);
  const [newPayout, setNewPayout] = useState({
    employee: "Rahul",
    approvedAmount: 9500,
    paymentDate: "15-11-2026",
    paymentMethod: "Bank Transfer",
    referenceNumber: "UTR123459",
  });

  const payoutStatuses = [
    "Not Scheduled",
    "Scheduled",
    "Processing",
    "Partially Paid",
    "Paid",
    "Failed",
    "Reconciled",
  ];

  const handleCreateBatch = (e) => {
    e.preventDefault();
    const item = {
      id: `PAY00${payouts.length + 1}`,
      batchId: `BATCH-NOV-0${payouts.length + 1}`,
      statementId: "STMT001",
      ...newPayout,
      approvedAmount: Number(newPayout.approvedAmount),
      bankPaidAmount: Number(newPayout.approvedAmount),
      status: "Paid",
    };
    setPayouts((prev) => [item, ...prev]);
    setBatchModal(false);
    notify(`Payout batch ${item.batchId} recorded for ${item.employee}.`);
  };

  const runBankReconciliation = () => {
    let matchedCount = 0;
    let flaggedCount = 0;
    setPayouts((prev) =>
      prev.map((p) => {
        if (p.approvedAmount === p.bankPaidAmount && p.bankPaidAmount > 0) {
          matchedCount++;
          return { ...p, status: "Reconciled" };
        } else {
          flaggedCount++;
          return {
            ...p,
            status: p.bankPaidAmount > 0 ? "Partially Paid" : "Failed",
          };
        }
      }),
    );
    notify(
      `Bank Reconciliation Complete: ${matchedCount} matched & marked Reconciled; ${flaggedCount} flagged for variance review.`,
    );
  };

  const exportPayoutCSV = () => {
    downloadCSV(
      "Payout_Reconciliation_Nov2026.csv",
      [
        "Payout ID",
        "Batch",
        "Employee",
        "Approved Amount",
        "Bank Record Amount",
        "Payment Date",
        "Method",
        "UTR Reference",
        "Status",
      ],
      payouts.map((p) => [
        p.id,
        p.batchId,
        p.employee,
        p.approvedAmount,
        p.bankPaidAmount,
        p.paymentDate,
        p.paymentMethod,
        p.referenceNumber,
        p.status,
      ]),
    );
    notify("Exported Payout & Reconciliation ledger CSV.");
  };

  return (
    <div className="space-y-6">
      <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-950 flex items-center gap-2.5">
        <Info className="w-4 h-4 text-blue-600 shrink-0" />
        <span>
          <strong>MVP Payout & Reconciliation Scope:</strong> Auron CommissionOS
          tracks payout batches, UTR references, and reconciles company bank
          payment feeds against approved statements without executing direct
          bank fund transfers.
        </span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Payout Batches & Bank Reconciliation
          </h2>
          <p className="text-xs text-slate-500">
            Match approved payout records against imported bank payment
            statements.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setBatchModal(true)}
            className="px-4 py-2 rounded-xl bg-[#0A0A0B] text-white text-xs font-bold"
          >
            + Create Payout Batch
          </button>
          <button
            onClick={runBankReconciliation}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5"
          >
            <FileCheck className="w-4 h-4" /> Import Bank Feed & Auto-Reconcile
          </button>
          <button
            onClick={exportPayoutCSV}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" /> Export Payout Data
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                <th className="py-3 px-3">Employee</th>
                <th className="py-3 px-3">Batch / Stmt</th>
                <th className="py-3 px-3 text-right">Approved Amount</th>
                <th className="py-3 px-3 text-right">Bank Payment Record</th>
                <th className="py-3 px-3">Payment Date</th>
                <th className="py-3 px-3">Payment Method</th>
                <th className="py-3 px-3">Reference Number</th>
                <th className="py-3 px-3">Reconciliation Match</th>
                <th className="py-3 px-3">Payment Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payouts.map((p) => {
                const isMatched = p.approvedAmount === p.bankPaidAmount;
                return (
                  <tr
                    key={p.id}
                    className={
                      !isMatched ? "bg-rose-50/50" : "hover:bg-slate-50/80"
                    }
                  >
                    <td className="py-3 px-3 font-bold text-slate-900">
                      {p.employee}
                    </td>
                    <td className="py-3 px-3 text-slate-500">
                      {p.batchId} • {p.statementId}
                    </td>
                    <td className="py-3 px-3 text-right font-bold">
                      {formatINR(p.approvedAmount)}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-blue-700">
                      {formatINR(p.bankPaidAmount)}
                    </td>
                    <td className="py-3 px-3">{p.paymentDate}</td>
                    <td className="py-3 px-3">{p.paymentMethod}</td>
                    <td className="py-3 px-3 font-mono font-semibold text-slate-700">
                      {p.referenceNumber}
                    </td>
                    <td className="py-3 px-3">
                      {isMatched ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                          Matched ✓
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-semibold">
                          Variance (
                          {formatINR(p.bankPaidAmount - p.approvedAmount)})
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <select
                        value={p.status}
                        onChange={(e) =>
                          setPayouts((prev) =>
                            prev.map((x) =>
                              x.id === p.id
                                ? { ...x, status: e.target.value }
                                : x,
                            ),
                          )
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold bg-white"
                      >
                        {payoutStatuses.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {batchModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateBatch}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <h3 className="text-base font-bold text-slate-900">
              Record Payout Batch Entry
            </h3>
            <div className="space-y-3">
              <div>
                <label className="font-semibold block mb-1">Employee</label>
                <input
                  value={newPayout.employee}
                  onChange={(e) =>
                    setNewPayout({ ...newPayout, employee: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">
                  Approved Amount (₹)
                </label>
                <input
                  type="number"
                  value={newPayout.approvedAmount}
                  onChange={(e) =>
                    setNewPayout({
                      ...newPayout,
                      approvedAmount: Number(e.target.value),
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold block mb-1">
                    Payment Date
                  </label>
                  <input
                    value={newPayout.paymentDate}
                    onChange={(e) =>
                      setNewPayout({
                        ...newPayout,
                        paymentDate: e.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">
                    UTR Reference
                  </label>
                  <input
                    value={newPayout.referenceNumber}
                    onChange={(e) =>
                      setNewPayout({
                        ...newPayout,
                        referenceNumber: e.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBatchModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold"
              >
                Save Payout Record
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MODULE 11: DISPUTES & ADJUSTMENTS
// ============================================================================
function ModuleDisputes({
  disputes,
  setDisputes,
  statements,
  transactions,
  adjustments,
  setAdjustments,
  setActiveModule,
  accessLevel = "admin",
  currentUserName = "",
  employees = [],
  org = {},
  notify,
}) {
  const isEmployee = accessLevel === "employee";
  const lcv = (v) =>
    String(v || "")
      .trim()
      .toLowerCase();
  // an employee only ever raises / comments on their own disputes (the server enforces it as well)
  const myName = isEmployee
    ? (employees.find((e) => lcv(e.name) === lcv(currentUserName)) || {})
      .name || currentUserName
    : "";
  const pad2 = (n) => String(n).padStart(2, "0");
  const todayDmy = () => {
    const d = new Date();
    return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
  };
  const nextId = (prefix, list) =>
    `${prefix}${String(list.reduce((mx, x) => Math.max(mx, parseInt(String(x.id).replace(/\D/g, ""), 10) || 0), 0) + 1).padStart(3, "0")}`;
  const statementOptions = isEmployee
    ? statements.filter((s) => lcv(s.employee) === lcv(myName))
    : statements;
  const transactionOptions = isEmployee
    ? transactions.filter((x) => lcv(x.salesperson) === lcv(myName))
    : transactions;
  const scrollToId = (id) =>
    setTimeout(
      () =>
        document
          .getElementById(id)
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      200,
    );
  const [newAdjId, setNewAdjId] = useState("");
  const [form, setForm] = useState({
    employee: myName || currentUserName || "Rahul",
    statementId:
      (isEmployee ? statementOptions[0] : statements[0])?.id || "STMT001",
    transactionId:
      (isEmployee ? transactionOptions[0] : transactions[0])?.id || "TXN001",
    claimedAmount: 12000,
    reason: "",
    document: "Invoice.pdf",
  });
  const [activeDispute, setActiveDispute] = useState(disputes[0]);
  const [note, setNote] = useState("");
  const [tileFilter, setTileFilter] = useState("all"); // all | open | closed

  const OPEN_STAGES = ["Open", "Under Review", "Awaiting Information"];
  const CLOSED_STAGES = ["Resolved", "Closed"];
  const visibleDisputes = disputes.filter((d) =>
    tileFilter === "open"
      ? OPEN_STAGES.includes(d.status)
      : tileFilter === "closed"
        ? CLOSED_STAGES.includes(d.status)
        : true,
  );

  const workflowStages = [
    "Open",
    "Under Review",
    "Awaiting Information",
    "Resolved",
    "Rejected",
    "Closed",
  ];

  const handleSubmitDispute = (e) => {
    e.preventDefault();
    const created = {
      id: nextId("DSP", disputes),
      ...form,
      claimedAmount: Number(form.claimedAmount),
      currentAmount: 9500,
      assignedTo: "Kavita Deshmukh (Finance)",
      status: "Open",
      createdDate: todayDmy(),
      comments: [
        {
          author: form.employee,
          text: `Raised dispute: ${form.reason} (Attached: ${form.document})`,
          time: new Date().toLocaleString("en-IN"),
        },
      ],
    };
    setDisputes((prev) => [created, ...prev]);
    setActiveDispute(created);
    setForm({ ...form, reason: "" });
    notify(
      `Dispute ${created.id} submitted! Note: Finalised statement remains locked until resolved.`,
    );
    scrollToId("dispute-detail");
  };

  const updateDisputeStatus = (dsp, nextStatus) => {
    setDisputes((prev) =>
      prev.map((d) => (d.id === dsp.id ? { ...d, status: nextStatus } : d)),
    );
    setActiveDispute((prev) =>
      prev?.id === dsp.id ? { ...prev, status: nextStatus } : prev,
    );
    notify(`Dispute ${dsp.id} moved to "${nextStatus}".`);
  };

  const addInternalComment = () => {
    if (!note.trim() || !activeDispute) return;
    if (isEmployee && lcv(activeDispute.employee) !== lcv(myName)) {
      notify("You can only comment on your own disputes.", "error");
      return;
    }
    const entry = {
      author: isEmployee
        ? myName
        : accessLevel === "admin"
          ? `${currentUserName || "Admin"} (Admin)`
          : currentUserName || "User",
      text: note,
      time: new Date().toLocaleString("en-IN"),
    };
    setDisputes((prev) =>
      prev.map((d) =>
        d.id === activeDispute.id
          ? { ...d, comments: [...d.comments, entry] }
          : d,
      ),
    );
    setActiveDispute((prev) => ({
      ...prev,
      comments: [...prev.comments, entry],
    }));
    setNote("");
  };

  const createAuthorisedAdjustment = (dsp) => {
    const diff = Math.max(0, dsp.claimedAmount - dsp.currentAmount) || 2500;
    const adj = {
      id: nextId("ADJ", adjustments),
      employee: dsp.employee,
      statementId: dsp.statementId,
      type: "Dispute Resolution Credit",
      amount: diff,
      reason: `Authorised adjustment from resolved dispute ${dsp.id}`,
      requestedBy: `${currentUserName || "Admin"} (Admin)`,
      date: todayDmy(),
      status: "Approved",
    };
    setAdjustments((prev) => [adj, ...prev]);
    updateDisputeStatus(dsp, "Resolved");
    setNewAdjId(adj.id);
    notify(
      `Created authorised adjustment ${adj.id} for ${formatINR(diff)} without altering locked statement.`,
    );
    scrollToId("adjustments-register");
  };

  return (
    <div className="space-y-6">
      <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-center gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
        <span>
          <strong>Audit Integrity Rule:</strong> Raising a dispute does not
          automatically alter a finalised commission statement. Approved
          resolutions generate a separate authorised Adjustment record.
        </span>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total Disputes",
            value: disputes.length,
            cls: "from-slate-800 to-slate-700",
            filter: "all",
          },
          {
            label: "Open / In Review",
            value: disputes.filter((d) =>
              ["Open", "Under Review", "Awaiting Information"].includes(
                d.status,
              ),
            ).length,
            cls: "from-amber-500 to-orange-500",
            filter: "open",
          },
          {
            label: "Resolved / Closed",
            value: disputes.filter((d) =>
              ["Resolved", "Closed"].includes(d.status),
            ).length,
            cls: "from-emerald-600 to-teal-600",
            filter: "closed",
          },
          {
            label: "Adjustments Created",
            value: adjustments.length,
            cls: "from-blue-600 to-indigo-600",
            filter: "adjustments",
          },
        ].map((k) => (
          <div
            key={k.label}
            role="button"
            tabIndex={0}
            data-allow="all"
            title={
              k.filter === "adjustments"
                ? "Go to Adjustments register"
                : "Click to filter the disputes list"
            }
            onClick={() => {
              if (k.filter === "adjustments") {
                scrollToId("adjustments-register");
                return;
              }
              setTileFilter(k.filter);
              const first = disputes.find((d) =>
                k.filter === "open"
                  ? OPEN_STAGES.includes(d.status)
                  : k.filter === "closed"
                    ? CLOSED_STAGES.includes(d.status)
                    : true,
              );
              if (first) setActiveDispute(first);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.click();
            }}
            className={`rounded-2xl bg-white border p-4 flex items-center gap-3 shadow-xs cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition ${
              k.filter === tileFilter ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200"
            }`}
          >
            <div
              className={`w-11 h-11 rounded-xl bg-gradient-to-br ${k.cls} text-white font-extrabold text-lg flex items-center justify-center`}
            >
              {k.value}
            </div>
            <div className="text-xs font-semibold text-slate-600 leading-tight">
              {k.label}
            </div>
          </div>
        ))}
      </div>

      {/* admin only reviews & resolves disputes; employees / users raise them */}
      {(isEmployee || accessLevel === "user") && (
        <form
          data-allow="employee user"
          onSubmit={handleSubmitDispute}
          className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4 text-xs"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Raise Commission Dispute
              </h3>
              <p className="text-slate-500">
                Select the statement and transaction, then describe what looks
                wrong.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="font-semibold block mb-1">Employee</label>
              <input
                value={form.employee}
                readOnly={isEmployee}
                onChange={(e) => setForm({ ...form, employee: e.target.value })}
                className={`w-full rounded-xl border border-slate-300 px-3 py-2.5 ${isEmployee ? "bg-slate-100 font-semibold" : ""}`}
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Statement ID</label>
              <select
                value={form.statementId}
                onChange={(e) =>
                  setForm({ ...form, statementId: e.target.value })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 bg-white"
              >
                {statementOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-semibold block mb-1">Transaction ID</label>
              <select
                value={form.transactionId}
                onChange={(e) =>
                  setForm({ ...form, transactionId: e.target.value })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 bg-white"
              >
                {transactionOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-semibold block mb-1">
                Expected Commission (₹)
              </label>
              <input
                type="number"
                value={form.claimedAmount}
                onChange={(e) =>
                  setForm({ ...form, claimedAmount: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-end">
            <div className="lg:col-span-2">
              <label className="font-semibold block mb-1">
                Dispute Reason *
              </label>
              <input
                required
                placeholder="e.g., Missing sales commission on add-on invoice INV1001"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">
                Supporting Document
              </label>
              <input
                value={form.document}
                onChange={(e) => setForm({ ...form, document: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
              />
            </div>
            <button
              type="submit"
              className="py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
            >
              Submit Dispute
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                  <th className="whitespace-nowrap py-3 px-3">Dispute ID</th>
                  <th className="whitespace-nowrap py-3 px-3">Employee</th>
                  <th className="whitespace-nowrap py-3 px-3">Stmt / TXN</th>
                  <th className="whitespace-nowrap py-3 px-3">Reason</th>
                  <th className="whitespace-nowrap py-3 px-3">Document</th>
                  <th className="whitespace-nowrap py-3 px-3">
                    Workflow Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleDisputes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 px-3 text-center text-slate-400">
                      No disputes in this category.
                    </td>
                  </tr>
                )}
                {visibleDisputes.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setActiveDispute(d)}
                    className={`cursor-pointer ${activeDispute?.id === d.id
                      ? "bg-blue-50/70"
                      : "hover:bg-slate-50"
                      }`}
                  >
                    <td className="whitespace-nowrap py-3 px-3 font-bold text-blue-600">
                      {d.id}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3 font-semibold">
                      {d.employee}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3">
                      {d.statementId} • {d.transactionId}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3 max-w-[200px] truncate">
                      {d.reason}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3 text-blue-700 underline">
                      {d.document}
                    </td>
                    <td className="whitespace-nowrap py-3 px-3">
                      <select
                        value={d.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateDisputeStatus(d, e.target.value)}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold bg-white min-w-[130px]"
                      >
                        {workflowStages.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {activeDispute &&
          (() => {
            const stageIdx = workflowStages.indexOf(activeDispute.status);
            const tone = (st) =>
              st === "Resolved" || st === "Closed"
                ? "bg-emerald-100 text-emerald-800"
                : st === "Rejected"
                  ? "bg-rose-100 text-rose-800"
                  : "bg-amber-100 text-amber-800";
            return (
              <div
                id="dispute-detail"
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4 text-xs self-start scroll-mt-4"
              >
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <span className="font-bold text-blue-600">
                      {activeDispute.id}
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 mt-0.5">
                      {activeDispute.employee}
                    </h4>
                    <div className="text-slate-500">
                      Assigned: {activeDispute.assignedTo}
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full font-bold whitespace-nowrap ${tone(activeDispute.status)}`}
                  >
                    {activeDispute.status}
                  </span>
                </div>

                <p className="text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3 leading-relaxed">
                  {activeDispute.reason}
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <div className="text-[10px] uppercase font-semibold text-slate-500">
                      Current Commission
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 mt-0.5">
                      {formatINR(activeDispute.currentAmount)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
                    <div className="text-[10px] uppercase font-semibold text-blue-600">
                      Expected Commission
                    </div>
                    <div className="text-sm font-extrabold text-blue-950 mt-0.5">
                      {formatINR(activeDispute.claimedAmount)}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">
                    Workflow Progress
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {workflowStages.map((st, i) => (
                      <span
                        key={st}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border whitespace-nowrap ${st === activeDispute.status
                          ? "bg-blue-600 text-white border-blue-600"
                          : i < stageIdx
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-white text-slate-400 border-slate-200"
                          }`}
                      >
                        {st}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">
                    Discussion Timeline
                  </div>
                  <ol className="relative border-l-2 border-slate-200 ml-2 space-y-3 max-h-48 overflow-y-auto pr-1">
                    {activeDispute.comments.map((c, i) => (
                      <li key={i} className="ml-4 relative">
                        <span className="absolute -left-[22px] top-1 w-3 h-3 rounded-full bg-blue-500 ring-4 ring-white" />
                        <div className="font-bold text-slate-800">
                          {c.author}
                        </div>
                        <p className="text-slate-600 mt-0.5">{c.text}</p>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {c.time}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setActiveModule && setActiveModule("statements")
                    }
                    className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 font-bold hover:bg-blue-100 flex items-center gap-1"
                  >
                    <FileText className="w-3.5 h-3.5" /> Open{" "}
                    {activeDispute.statementId}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveModule && setActiveModule("transactions")
                    }
                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 flex items-center gap-1"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" /> Open{" "}
                    {activeDispute.transactionId}
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollToId("adjustments-register")}
                    className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 font-bold hover:bg-emerald-100 flex items-center gap-1"
                  >
                    <ArrowDownRight className="w-3.5 h-3.5" /> Adjustments
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      downloadPdf(
                        `${activeDispute.id}-invoice.pdf`,
                        (logo) => disputeInvoiceOps(activeDispute, org, logo),
                        org,
                      );
                      notify(
                        `Invoice for ${activeDispute.id} downloaded as PDF.`,
                      );
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#0A0A0B] text-white font-bold hover:bg-slate-800 flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" /> Invoice PDF
                  </button>
                </div>

                <div className="flex gap-1.5" data-allow="employee user">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add internal finance review note..."
                    className="flex-1 rounded-xl border border-slate-300 px-3 py-2"
                  />
                  <button
                    type="button"
                    onClick={addInternalComment}
                    className="px-3.5 py-2 rounded-xl bg-[#0A0A0B] text-white font-bold"
                  >
                    Post
                  </button>
                </div>

                <div className="pt-3 border-t border-slate-100 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => createAuthorisedAdjustment(activeDispute)}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold whitespace-nowrap"
                  >
                    Resolve & Create Adjustment
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateDisputeStatus(activeDispute, "Rejected")
                    }
                    className="py-2.5 px-4 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold"
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })()}
      </div>

      <div
        id="adjustments-register"
        className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden scroll-mt-4"
      >
        <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Authorised Adjustments Register
            </h3>
            <p className="text-xs text-slate-500">
              Created from resolved disputes — the locked statement itself is
              never edited.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveModule && setActiveModule("statements")}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 whitespace-nowrap"
          >
            View Statements →
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                <th className="whitespace-nowrap py-3 px-4">Adjustment</th>
                <th className="whitespace-nowrap py-3 px-4">Employee</th>
                <th className="whitespace-nowrap py-3 px-4">Statement</th>
                <th className="whitespace-nowrap py-3 px-4">Type</th>
                <th className="whitespace-nowrap py-3 px-4 text-right">
                  Amount
                </th>
                <th className="whitespace-nowrap py-3 px-4">Date</th>
                <th className="whitespace-nowrap py-3 px-4">Status</th>
                <th className="whitespace-nowrap py-3 px-4 text-center">
                  Invoice
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {adjustments.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No adjustments yet. Resolve a dispute to create one.
                  </td>
                </tr>
              )}
              {adjustments.map((a) => (
                <tr
                  key={a.id}
                  className={`${a.id === newAdjId ? "bg-emerald-50" : "hover:bg-slate-50"} transition`}
                >
                  <td className="whitespace-nowrap py-3 px-4 font-bold text-blue-600">
                    {a.id}
                    {a.id === newAdjId && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px]">
                        NEW
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4 font-semibold text-slate-900">
                    {a.employee}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4">
                    {a.statementId}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4 text-slate-600">
                    {a.type}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4 text-right font-extrabold text-slate-900">
                    {formatINR(a.amount)}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4 text-slate-500">
                    {a.date}
                  </td>
                  <td className="whitespace-nowrap py-3 px-4">
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                      {a.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-3 px-4 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        downloadPdf(
                          `${a.id}-invoice.pdf`,
                          (logo) => adjustmentInvoiceOps(a, org, logo),
                          org,
                        );
                        notify(`Invoice for ${a.id} downloaded as PDF.`);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#0A0A0B] hover:bg-slate-800 text-white font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" /> PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// REPORT CHARTS (pure SVG — no extra libraries needed)
// ============================================================================
const CHART_COLORS = [
  "#DC2626",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#06B6D4",
  "#EC4899",
  "#84CC16",
];

const parseChartNum = (v) => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const REPORT_CHART_CONFIG = {
  monthly: { label: 0, value: 5, name: "Net Commission" },
  employee: { label: 1, value: 6, name: "Earned Commission" },
  partner: { label: 1, value: 5, name: "Partner Commission" },
  product: { label: 0, value: 4, name: "Generated Commission" },
  team: { label: 0, value: 2, name: "Members", plain: true },
  target: { label: 0, value: 3, name: "Actual Eligible Sales" },
  pending: { label: 1, value: 3, name: "Pending Amount" },
  approved: { label: 1, value: 3, name: "Approved Amount" },
  payout: { label: 1, value: 3, name: "Bank Paid Amount" },
  reversal: { label: 2, value: 5, name: "Reversed Commission" },
  adjustment: { label: 1, value: 4, name: "Adjustment Amount" },
  dispute: { group: 6, name: "Disputes by Status", plain: true },
  liability: { label: 0, value: 4, name: "Net Outstanding Liability" },
};

function ReportCharts({ reportId, headers, rows }) {
  const cfg = REPORT_CHART_CONFIG[reportId];
  if (!cfg || !rows || rows.length === 0) return null;

  let data;
  if (cfg.group !== undefined) {
    const counts = {};
    rows.forEach((r) => {
      const k = String(r[cfg.group] ?? "Unknown");
      counts[k] = (counts[k] || 0) + 1;
    });
    data = Object.entries(counts).map(([label, value]) => ({ label, value }));
  } else {
    // sum duplicates (e.g. same employee in several rows) so the pie stays clean
    const map = new Map();
    rows.forEach((r) => {
      const k = String(r[cfg.label] ?? "");
      map.set(k, (map.get(k) || 0) + parseChartNum(r[cfg.value]));
    });
    data = Array.from(map, ([label, value]) => ({ label, value }));
  }
  data = data.filter((d) => d.value > 0);
  if (data.length === 0) return null;

  const fmt = (v) => (cfg.plain ? v.toLocaleString("en-IN") : formatINR(v));
  const total = data.reduce((s, d) => s + d.value, 0);
  const max = Math.max(...data.map((d) => d.value));
  const shortLabel = (l) => (l.length > 12 ? l.slice(0, 11) + "…" : l);

  // ---- bar chart geometry ----
  const W = 520,
    H = 260,
    padL = 52,
    padR = 12,
    padT = 16,
    padB = 46;
  const innerW = W - padL - padR,
    innerH = H - padT - padB;
  const slot = innerW / data.length;
  const barW = Math.min(46, slot * 0.6);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const compact = (v) =>
    cfg.plain
      ? String(Math.round(v))
      : v >= 1e7
        ? `${(v / 1e7).toFixed(1)}Cr`
        : v >= 1e5
          ? `${(v / 1e5).toFixed(1)}L`
          : v >= 1e3
            ? `${(v / 1e3).toFixed(0)}K`
            : String(Math.round(v));

  // ---- donut geometry ----
  const R = 78,
    r = 48,
    cx = 100,
    cy = 100;
  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const frac = d.value / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const full = frac > 0.9999;
    const [x0, y0] = p(R, a0),
      [x1, y1] = p(R, full ? a0 + Math.PI : a1);
    const [x2, y2] = p(r, full ? a0 + Math.PI : a1),
      [x3, y3] = p(r, a0);
    const path = full
      ? `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx} ${cy + R} A ${R} ${R} 0 1 1 ${cx} ${cy - R} M ${cx} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy + r} A ${r} ${r} 0 1 0 ${cx} ${cy - r} Z`
      : `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
    return {
      ...d,
      path,
      pct: frac * 100,
      color: CHART_COLORS[i % CHART_COLORS.length],
    };
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Bar chart */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-bold text-slate-900 mb-1">
          {cfg.name} — Bar Graph
        </div>
        <div className="text-[11px] text-slate-500 mb-2">
          {headers[cfg.label ?? cfg.group]} vs {cfg.name}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {ticks.map((t) => {
            const y = padT + innerH - innerH * t;
            return (
              <g key={t}>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={y}
                  y2={y}
                  stroke="#3F3F46"
                  strokeDasharray="3 3"
                />
                <text
                  x={padL - 6}
                  y={y + 3}
                  fontSize="9"
                  textAnchor="end"
                  fill="#A1A1AA"
                >
                  {compact(max * t)}
                </text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const h = (d.value / max) * innerH;
            const x = padL + slot * i + (slot - barW) / 2;
            const y = padT + innerH - h;
            return (
              <g key={d.label}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx="5"
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                >
                  <title>{`${d.label}: ${fmt(d.value)}`}</title>
                </rect>
                <text
                  x={x + barW / 2}
                  y={y - 4}
                  fontSize="9"
                  textAnchor="middle"
                  fill="#E4E4E7"
                  fontWeight="600"
                >
                  {compact(d.value)}
                </text>
                <text
                  x={x + barW / 2}
                  y={H - padB + 14}
                  fontSize="9"
                  textAnchor="middle"
                  fill="#A1A1AA"
                >
                  {shortLabel(d.label)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Pie / donut chart */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-bold text-slate-900 mb-1">
          {cfg.name} — Pie Chart
        </div>
        <div className="text-[11px] text-slate-500 mb-2">
          Share of total: {fmt(total)}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <svg viewBox="0 0 200 200" className="w-44 h-44 shrink-0">
            {slices.map((sl) => (
              <path
                key={sl.label}
                d={sl.path}
                fill={sl.color}
                fillRule="evenodd"
                stroke="#18181B"
                strokeWidth="1.5"
              >
                <title>{`${sl.label}: ${fmt(sl.value)} (${sl.pct.toFixed(1)}%)`}</title>
              </path>
            ))}
            <text
              x={cx}
              y={cy - 2}
              textAnchor="middle"
              fontSize="10"
              fill="#A1A1AA"
            >
              Total
            </text>
            <text
              x={cx}
              y={cy + 12}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill="#FAFAFA"
            >
              {compact(total)}
            </text>
          </svg>
          <div className="space-y-1.5 text-xs min-w-[150px]">
            {slices.map((sl) => (
              <div key={sl.label} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: sl.color }}
                />
                <span className="text-slate-700 font-medium truncate max-w-[130px]">
                  {sl.label}
                </span>
                <span className="ml-auto font-bold text-slate-900">
                  {sl.pct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MODULE 12: REPORTS & ANALYTICS (ALL 13 REPORTS + FILTERS + CSV/EXCEL/PDF)
// ============================================================================
function ModuleReports({
  employees,
  transactions,
  statements,
  payouts,
  reversals,
  adjustments,
  disputes,
  policies,
  departments,
  notify,
}) {
  const reportCatalog = [
    { id: 'monthly', title: 'Monthly Commission', desc: 'Total commission accrued for each month' },
    { id: 'employee', title: 'Employee-wise', desc: 'Commission earned by each employee' },
    { id: 'partner', title: 'Partner-wise', desc: 'Referral and channel partner commissions' },
    { id: 'product', title: 'Product-wise', desc: 'Commission generated by each product SKU' },
    { id: 'team', title: 'Team Performance', desc: 'Sales & incentive performance by team' },
    { id: 'target', title: 'Target Achievement', desc: 'Employees quota completion percentages' },
    { id: 'pending', title: 'Pending Commission', desc: 'Commission statements awaiting approval' },
    { id: 'approved', title: 'Approved Commission', desc: 'Finalised and approved commission amounts' },
    { id: 'payout', title: 'Payout Status', desc: 'Paid, reconciled, and unpaid commissions' },
    { id: 'reversal', title: 'Reversal Report', desc: 'Customer refunds and clawed-back commissions' },
    { id: 'adjustment', title: 'Adjustment Report', desc: 'Manual commission credits & debits' },
    { id: 'dispute', title: 'Dispute Report', desc: 'Open, under review, and resolved disputes' },
    { id: 'liability', title: 'Commission Liability', desc: 'Outstanding unpaid commission obligations' },
  ];

  const [selectedReport, setSelectedReport] = useState('employee');
  const [filters, setFilters] = useState({
    dateRange: 'Nov 2026',
    employee: 'All',
    team: 'All',
    branch: 'All',
    product: 'All',
    policy: 'All',
    status: 'All',
  });

  const reportTable = useMemo(() => {
    switch (selectedReport) {
      case 'monthly':
        return {
          headers: ['Month', 'Eligible Sales', 'Gross Commission', 'Reversals', 'Net Commission', 'Status'],
          rows: [
            ['September 2026', '₹21,40,000', '₹1,28,000', '₹2,000', '₹1,26,000', 'Closed'],
            ['October 2026', '₹22,90,000', '₹1,37,000', '₹1,500', '₹1,35,500', 'Closed'],
            ['November 2026', '₹25,00,000', '₹1,50,000', '₹5,000', '₹1,45,000', 'Active'],
          ],
        };
      case 'employee':
        return {
          headers: ['Employee ID', 'Name', 'Department', 'Branch', 'Plan', 'Eligible Sales', 'Earned Commission'],
          rows: employees
            .filter((e) => e.type === 'Employee')
            .filter((e) => filters.employee === 'All' || e.name === filters.employee)
            .filter((e) => filters.team === 'All' || e.department === filters.team)
            .filter((e) => filters.branch === 'All' || e.branch === filters.branch)
            .map((e) => [e.id, e.name, e.department, e.branch, e.planName, formatINR(e.eligibleSales), formatINR(e.earnedCommission)]),
        };
      case 'partner':
        return {
          headers: ['Partner ID', 'Partner Name', 'Branch', 'Plan', 'Referred Sales', 'Partner Commission', 'Status'],
          rows: employees
            .filter((e) => e.type === 'Partner')
            .map((p) => [p.id, p.name, p.branch, p.planName, formatINR(p.eligibleSales), formatINR(p.earnedCommission), p.status]),
        };
      case 'product':
        return {
          headers: ['Product SKU', 'Transactions', 'Eligible Sales Base', 'Applicable Rate', 'Generated Commission'],
          rows: ['Product A', 'Product B', 'Product C'].map((prod, idx) => {
            const pTxns = transactions.filter((t) => t.product === prod);
            const sum = pTxns.reduce((a, b) => a + b.eligibleBase, 0);
            const rate = idx === 0 ? 3 : idx === 1 ? 5 : 8;
            return [prod, pTxns.length, formatINR(sum), `${rate}%`, formatINR((sum * rate) / 100)];
          }),
        };
      case 'team':
        return {
          headers: ['Team / Department', 'Team Lead', 'Members', 'Quota Target', 'Actual Sales', 'Commission Accrued'],
          rows: departments.map((d) => [d.name, d.head, d.members, d.budgetTarget, '₹8,50,000', '₹45,000']),
        };
      case 'target':
        return {
          headers: ['Employee', 'Department', 'Monthly Target', 'Actual Eligible Sales', 'Achievement %', 'Bonus Eligibility'],
          rows: employees.map((e) => {
            const pct = Math.round((e.eligibleSales / e.monthlyTarget) * 100);
            return [e.name, e.department, formatINR(e.monthlyTarget), formatINR(e.eligibleSales), `${pct}%`, pct >= 100 ? 'Qualified (₹10,000)' : 'In Progress'];
          }),
        };
      case 'pending':
        return {
          headers: ['Statement ID', 'Employee', 'Period', 'Pending Amount', 'Submitted Date', 'Status'],
          rows: statements
            .filter((s) => s.status === 'Pending Approval' || s.status === 'Draft')
            .map((s) => [s.id, s.employee, s.period, formatINR(s.netPayable), s.submittedDate, s.status]),
        };
      case 'approved':
        return {
          headers: ['Statement ID', 'Employee', 'Period', 'Approved Amount', 'Locked', 'Status'],
          rows: statements
            .filter((s) => s.status === 'Approved' || s.status === 'Finalised & Locked')
            .map((s) => [s.id, s.employee, s.period, formatINR(s.netPayable), s.locked ? 'Yes' : 'No', s.status]),
        };
      case 'payout':
        return {
          headers: ['Payout ID', 'Employee', 'Approved Amt', 'Bank Paid Amt', 'Payment Date', 'Reference', 'Status'],
          rows: payouts.map((p) => [p.id, p.employee, formatINR(p.approvedAmount), formatINR(p.bankPaidAmount), p.paymentDate, p.referenceNumber, p.status]),
        };
      case 'reversal':
        return {
          headers: ['Reversal ID', 'TXN ID', 'Employee', 'Type', 'Refund Amount', 'Reversed Commission', 'Remaining'],
          rows: reversals.map((r) => [r.id, r.transactionId, r.employee, r.type, formatINR(r.refundAmount), formatINR(r.reversedCommission), formatINR(r.remainingCommission)]),
        };
      case 'adjustment':
        return {
          headers: ['Adjustment ID', 'Employee', 'Statement ID', 'Type', 'Amount', 'Reason', 'Status'],
          rows: adjustments.map((a) => [a.id, a.employee, a.statementId, a.type, formatINR(a.amount), a.reason, a.status]),
        };
      case 'dispute':
        return {
          headers: ['Dispute ID', 'Employee', 'Statement', 'Transaction', 'Reason', 'Assigned To', 'Status'],
          rows: disputes.map((d) => [d.id, d.employee, d.statementId, d.transactionId, d.reason, d.assignedTo, d.status]),
        };
      case 'liability':
        return {
          headers: ['Category', 'Count', 'Total Accrued', 'Paid to Date', 'Net Outstanding Liability'],
          rows: [
            ['Approved & Unpaid Statements', 2, '₹80,000', '₹40,000', '₹40,000'],
            ['Pending Approval Accruals', 1, '₹30,000', '₹0', '₹30,000'],
            ['Open Dispute Reserves', 1, '₹2,500', '₹0', '₹2,500'],
          ],
        };
      default:
        return { headers: [], rows: [] };
    }
  }, [selectedReport, filters, employees, transactions, statements, payouts, reversals, adjustments, disputes, departments]);

  const activeMeta = reportCatalog.find((r) => r.id === selectedReport);

  return (
    <div className="space-y-6">
      <ReportsOverview statements={statements} employees={employees} />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {reportCatalog.map((rep) => (
          <button
            key={rep.id}
            onClick={() => setSelectedReport(rep.id)}
            className={`text-left p-3.5 rounded-2xl border transition-all ${selectedReport === rep.id
                ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                : 'bg-white text-slate-800 border-slate-200 hover:border-blue-300'
              }`}
          >
            <div className="text-xs font-bold">{rep.title}</div>
            <div
              className={`text-[11px] mt-1 line-clamp-1 ${selectedReport === rep.id ? 'text-blue-100' : 'text-slate-500'
                }`}
            >
              {rep.desc}
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">{activeMeta?.title} Report</h3>
            <p className="text-xs text-slate-500">{activeMeta?.desc}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                downloadCSV(`${activeMeta?.title}_Report.csv`, reportTable.headers, reportTable.rows);
                notify(`Exported ${activeMeta?.title} as CSV.`);
              }}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <button
              onClick={() => {
                downloadCSV(`${activeMeta?.title}_Excel.xls`, reportTable.headers, reportTable.rows);
                notify(`Exported ${activeMeta?.title} for Microsoft Excel.`);
              }}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
            </button>
            <button
              onClick={() => {
                window.print();
                notify(`Generating PDF for ${activeMeta?.title} report.`);
              }}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" /> Download PDF
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs">
          <select
            value={filters.dateRange}
            onChange={(e) => setFilters({ ...filters, dateRange: e.target.value })}
            className="rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
          >
            <option value="Nov 2026">Date: Nov 2026</option>
            <option value="Q3 FY26">Date: Q3 FY26</option>
          </select>
          <select
            value={filters.employee}
            onChange={(e) => setFilters({ ...filters, employee: e.target.value })}
            className="rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
          >
            <option value="All">Employee: All</option>
            {employees.map((e) => (
              <option key={e.id} value={e.name}>{e.name}</option>
            ))}
          </select>
          <select
            value={filters.team}
            onChange={(e) => setFilters({ ...filters, team: e.target.value })}
            className="rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
          >
            <option value="All">Team: All</option>
            {departments.map((d) => (
              <option key={d.id} value={d.name}>{d.name}</option>
            ))}
          </select>
          <select
            value={filters.branch}
            onChange={(e) => setFilters({ ...filters, branch: e.target.value })}
            className="rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
          >
            <option value="All">Branch: All</option>
            <option value="Bangalore">Bangalore</option>
            <option value="Mumbai">Mumbai</option>
            <option value="Hyderabad">Hyderabad</option>
            <option value="Delhi NCR">Delhi NCR</option>
          </select>
          <select
            value={filters.product}
            onChange={(e) => setFilters({ ...filters, product: e.target.value })}
            className="rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
          >
            <option value="All">Product: All</option>
            <option value="Product A">Product A</option>
            <option value="Product B">Product B</option>
            <option value="Product C">Product C</option>
          </select>
          <select
            value={filters.policy}
            onChange={(e) => setFilters({ ...filters, policy: e.target.value })}
            className="rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
          >
            <option value="All">Policy: All</option>
            {policies.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="rounded-xl border border-slate-300 px-2.5 py-2 bg-white"
          >
            <option value="All">Status: All</option>
            <option value="Active">Active / Approved</option>
            <option value="Pending">Pending</option>
          </select>
        </div>

        <ReportCharts reportId={selectedReport} headers={reportTable.headers} rows={reportTable.rows} />

        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                {reportTable.headers.map((h) => (
                  <th key={h} className="py-3 px-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reportTable.rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50/80">
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className={`py-3 px-4 ${cIdx === 0 ? 'font-bold text-blue-700' : 'text-slate-800'}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}