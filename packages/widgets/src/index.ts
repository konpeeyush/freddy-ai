/*
 * @workspace/widgets — the composable widget runtime.
 *
 * Your users author widgets in the dashboard from a fixed set of primitives;
 * the model only ever produces JSON matching a widget's schema. Nothing here
 * evaluates author-supplied code, which is what makes it safe to run inside
 * a customer's page.
 *
 *   registerWidgets(definitions)          // once, from the widget config
 *   setWidgetChatSender(send)             // once, so clicks can reach the AI
 *   <WidgetPart payload={…} />            // per message part
 */

export {
  isSafeUrl,
  isBind,
  isWidgetEnvelope,
  NODE_TYPES,
  WIDGET_ENVELOPE_KEY,
  ActionSchema,
  WidgetDefinitionSchema,
  WidgetNodeSchema,
  WidgetPayloadSchema,
  type Action,
  type Bind,
  type Condition,
  type Format,
  type NodeType,
  type Repeat,
  type WidgetDefinition,
  type WidgetNode,
  type WidgetPayload,
} from "./tree"

export {
  applyFormat,
  asText,
  formatMoney,
  resolveBind,
  resolvePath,
  resolveProps,
  resolveValue,
  testCondition,
  type Scope,
} from "./resolve"

export {
  ACK_TIMEOUT_MS,
  AckTimeoutError,
  dispatchWidgetAction,
  openLink,
  runAction,
  visitorMessageFromRejection,
  type DispatchResult,
} from "./actions"

export {
  emitWidgetAction,
  hasWidgetActionListener,
  onWidgetAction,
  setWidgetChatSender,
  type WidgetActionEvent,
} from "./events"

export {
  clearWidgets,
  getWidget,
  hasWidget,
  listWidgets,
  registerWidget,
  registerWidgets,
} from "./registry"

export { PRIMITIVES } from "./primitives"
export { Widget, type WidgetProps } from "./render"
export { WidgetPart } from "./widget-part"
export {
  STOCK_WIDGETS,
  articleSummaryWidget,
  cryptoPriceWidget,
  exchangeRateWidget,
  leadCaptureWidget,
  placeCarouselWidget,
  stayOptionsWidget,
  weatherWidget,
} from "./stock"
