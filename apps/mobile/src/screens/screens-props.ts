/**
 * PHASE-022 T-P22-2-e · the screen props type barrel (the registry + the
 * screens/index re-export these; ONE site so the registry's value imports
 * and the screens' own exports never tangle — screens export the
 * COMPONENT, this module exports the PROPS interface).
 */
export type { RouteVisitsScreenProps } from "./RouteVisitsScreen";
export type { VanSaleCaptureScreenProps } from "./VanSaleCaptureScreen";
export type { CollectionScreenProps } from "./CollectionScreen";
export type { VanLoadUnloadScreenProps } from "./VanLoadUnloadScreen";
export type { ReturnsScreenProps } from "./ReturnsScreen";
export type { CountLinesScreenProps } from "./CountLinesScreen";
export type { DashboardScreenProps } from "./DashboardScreen";
export type { StatementScreenProps } from "./StatementScreen";
export type { InvoicesScreenProps } from "./InvoicesScreen";
export type { PersonalHomeScreenProps } from "./PersonalHomeScreen";
export type { ParkedRejectionsScreenProps } from "./ParkedRejectionsScreen";
