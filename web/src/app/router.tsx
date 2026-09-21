/**
 * Router — role route map (§8.5–8.10), protected by RequireRole guards.
 */
import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./app-shell.js";
import { ForbiddenPage, NotFoundPage, PublicOnly, RequireAuth, RequireRole } from "./guards.js";
import { LoginPage } from "../features/auth/login-page.js";
import { RegisterPage } from "../features/auth/register-page.js";
import { AcceptInvitationPage } from "../features/auth/accept-invitation-page.js";
import {
  CitizenDashboard, CitizenPayouts, CitizenRequestDetail, CitizenRequests, CitizenTrack, NewCitizenRequest
} from "../features/citizen/citizen-pages.js";
import {
  CollectorDashboard, CollectorPayouts, CollectorRequestDetail, CollectorRequests, CollectorScan, CollectorSchedule
} from "../features/collector/collector-pages.js";
import {
  AuthorityDashboard, AuthorityRequestDetail, AuthorityRequests
} from "../features/authority/authority-pages.js";
import {
  NewShipmentPage, ShipmentDetail, SorterDashboard, SorterShipments, WeightsPage
} from "../features/sorter/sorter-pages.js";
import {
  FinanceDashboard, FinanceInvoices, FinanceLedger, FinancePayouts, InvoiceDetail, NewInvoicePage
} from "../features/finance/finance-pages.js";
import {
  ManagerAccounts, ManagerAudit, ManagerCatalog, ManagerDashboard, ManagerInvitations,
  ManagerSettings, ManagerTraceability
} from "../features/manager/manager-pages.js";

export const router = createBrowserRouter([
  { path: "/login", element: <PublicOnly><LoginPage /></PublicOnly> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/accept-invitation", element: <AcceptInvitationPage /> },

  {
    path: "/citizen",
    element: <RequireRole role="citizen"><AppShell /></RequireRole>,
    children: [
      { index: true, element: <CitizenDashboard /> },
      { path: "requests", element: <CitizenRequests /> },
      { path: "requests/new", element: <NewCitizenRequest /> },
      { path: "requests/:id", element: <CitizenRequestDetail /> },
      { path: "track/:hash", element: <CitizenTrack /> },
      { path: "track", element: <CitizenTrack /> },
      { path: "payouts", element: <CitizenPayouts /> },
      { path: "profile", element: <CitizenDashboard /> }
    ]
  },

  {
    path: "/collector",
    element: <RequireRole role="collector"><AppShell /></RequireRole>,
    children: [
      { index: true, element: <CollectorDashboard /> },
      { path: "schedule", element: <CollectorSchedule /> },
      { path: "requests", element: <CollectorRequests /> },
      { path: "requests/:id", element: <CollectorRequestDetail /> },
      { path: "scan", element: <CollectorScan /> },
      { path: "payouts", element: <CollectorPayouts /> },
      { path: "profile", element: <CollectorDashboard /> }
    ]
  },

  {
    path: "/authority",
    element: <RequireRole role="authority"><AppShell /></RequireRole>,
    children: [
      { index: true, element: <AuthorityDashboard /> },
      { path: "requests", element: <AuthorityRequests /> },
      { path: "requests/:id", element: <AuthorityRequestDetail /> },
      { path: "dispatch", element: <AuthorityDashboard /> },
      { path: "profile", element: <AuthorityDashboard /> }
    ]
  },

  {
    path: "/sorter",
    element: <RequireRole role="sorter"><AppShell /></RequireRole>,
    children: [
      { index: true, element: <SorterDashboard /> },
      { path: "shipments", element: <SorterShipments /> },
      { path: "shipments/new", element: <NewShipmentPage /> },
      { path: "shipments/:id", element: <ShipmentDetail /> },
      { path: "bags", element: <WeightsPage /> },
      { path: "weights", element: <WeightsPage /> }
    ]
  },

  {
    path: "/finance",
    element: <RequireRole role="finance"><AppShell /></RequireRole>,
    children: [
      { index: true, element: <FinanceDashboard /> },
      { path: "invoices", element: <FinanceInvoices /> },
      { path: "invoices/new", element: <NewInvoicePage /> },
      { path: "invoices/:id", element: <InvoiceDetail /> },
      { path: "payouts", element: <FinancePayouts /> },
      { path: "ledger", element: <FinanceLedger /> }
    ]
  },

  {
    path: "/manager",
    element: <RequireRole role="manager"><AppShell /></RequireRole>,
    children: [
      { index: true, element: <ManagerDashboard /> },
      { path: "overview", element: <ManagerDashboard /> },
      { path: "accounts", element: <ManagerAccounts /> },
      { path: "invitations", element: <ManagerInvitations /> },
      { path: "catalog", element: <ManagerCatalog /> },
      { path: "addons", element: <ManagerCatalog /> },
      { path: "settings", element: <ManagerSettings /> },
      { path: "traceability", element: <ManagerTraceability /> },
      { path: "audit", element: <ManagerAudit /> }
    ]
  },

  { path: "/forbidden", element: <RequireAuth><ForbiddenPage /></RequireAuth> },
  { path: "/", element: <RequireAuth><RoleRedirect /></RequireAuth> },
  { path: "*", element: <NotFoundPage /> }
]);

import { Navigate } from "react-router-dom";
import { useSession } from "./session.js";

function RoleRedirect(): React.ReactNode {
  const { user, ready } = useSession();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={`/${user.role}`} replace />;
}
