import type { ComponentType } from "react"

import { Button } from "./button"
import {
  Badge,
  Caption,
  Icon,
  Image,
  Progress,
  Rating,
  Text,
  Title,
} from "./content"
import { Checkbox, Form, Input, RadioGroup, Select } from "./form"
import {
  Box,
  Card,
  Col,
  Divider,
  Row,
  Spacer,
  type PrimitiveProps,
} from "./layout"
import { Carousel, Chart, ListView, ListViewItem } from "./structural"
import type { NodeType } from "../tree"

/**
 * The render registry.
 *
 * Every entry here must have a matching name in `NODE_TYPES`; the Record type
 * enforces that both directions stay in step, so adding a node type without a
 * renderer (or the reverse) is a compile error rather than a blank widget.
 */
export const PRIMITIVES: Record<NodeType, ComponentType<PrimitiveProps>> = {
  Box,
  Row,
  Col,
  Card,
  Divider,
  Spacer,
  Title,
  Text,
  Caption,
  Image,
  Icon,
  Badge,
  Rating,
  Progress,
  Button,
  Input,
  Select,
  Checkbox,
  RadioGroup,
  Form,
  ListView,
  ListViewItem,
  Carousel,
  Chart,
}

export type { PrimitiveProps }
