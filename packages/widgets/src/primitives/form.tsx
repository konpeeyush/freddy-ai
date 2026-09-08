import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { FormContext, useFormContext, type FormState } from "../context"
import { asText } from "../resolve"
import type { PrimitiveProps } from "./layout"

/*
 * Form primitives.
 *
 * Inputs register by `name` into one shared record; a `submit` button reads
 * it. Keeping values in the Form rather than on each control is what lets a
 * single action gather the whole form without the tree describing its own
 * shape.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Deliberately permissive: international numbers vary far more than any
// regex worth shipping, and a rejected valid number costs a lead.
const PHONE = /^[+]?[\d\s()-]{7,}$/

type Field = { required: boolean; label?: string; type?: string }

export function Form({ children }: PrimitiveProps) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  /*
   * Field registry lives in a ref, not state: registering during a child's
   * render would otherwise schedule a parent update mid-render.
   */
  const fields = useRef<Record<string, Field>>({})

  const register = useCallback(
    (name: string, required: boolean, label?: string) => {
      fields.current[name] = { ...fields.current[name], required, label }
    },
    []
  )

  const setValue = useCallback((name: string, value: unknown) => {
    setValues((current) => ({ ...current, [name]: value }))
    // Clearing on edit rather than re-validating: correcting a field should
    // remove its error immediately, not wait for another submit.
    setErrors((current) => {
      if (!current[name]) return current
      const next = { ...current }
      delete next[name]
      return next
    })
  }, [])

  const validate = useCallback(() => {
    const found: Record<string, string> = {}

    for (const [name, field] of Object.entries(fields.current)) {
      const value = values[name]
      const empty =
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "") ||
        value === false

      if (field.required && empty) {
        found[name] = `${field.label ?? "This field"} is required`
        continue
      }
      if (empty) continue

      const text = String(value)
      if (field.type === "email" && !EMAIL.test(text)) {
        found[name] = "Enter a valid email address"
      } else if (field.type === "tel" && !PHONE.test(text)) {
        found[name] = "Enter a valid phone number"
      }
    }

    setErrors(found)
    setSubmitted(true)
    return { ok: Object.keys(found).length === 0, values }
  }, [values])

  const state: FormState = useMemo(
    () => ({ values, errors, setValue, register, validate, submitted }),
    [values, errors, setValue, register, validate, submitted]
  )

  return (
    <FormContext.Provider value={state}>
      <div className="flex w-full flex-col gap-3">{children}</div>
    </FormContext.Provider>
  )
}

/** Shared label + error chrome, so every control reports failure the same way. */
function Field({
  name,
  label,
  error,
  children,
}: {
  name: string
  label?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      {label ? (
        <label htmlFor={name} className="text-xs font-medium text-foreground">
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

const CONTROL =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"

/** Registers a field and returns everything a control needs from the form. */
function useField(props: Record<string, unknown>, type?: string) {
  const form = useFormContext()
  const name = asText(props.name)
  const label = asText(props.label) || undefined
  const required = props.required === true

  useEffect(() => {
    if (!form || !name) return
    form.register(name, required, label)
    // `form.register` writes into a ref, so re-running is cheap and safe.
  }, [form, name, required, label, type])

  return { form, name, label, required, error: form?.errors[name] }
}

export function Input({ props }: PrimitiveProps) {
  const type = asText(props.type) || "text"
  const { form, name, label, error } = useField(props, type)
  if (!form || !name) return null

  const multiline = type === "textarea"
  const value = asText(form.values[name])

  return (
    <Field name={name} label={label} error={error}>
      {multiline ? (
        <textarea
          id={name}
          name={name}
          rows={typeof props.rows === "number" ? props.rows : 3}
          placeholder={asText(props.placeholder)}
          value={value}
          aria-invalid={Boolean(error)}
          onChange={(e) => form.setValue(name, e.target.value)}
          className={cn(CONTROL, "resize-none")}
        />
      ) : (
        <input
          id={name}
          name={name}
          type={type === "textarea" ? "text" : type}
          placeholder={asText(props.placeholder)}
          value={value}
          aria-invalid={Boolean(error)}
          onChange={(e) => form.setValue(name, e.target.value)}
          className={CONTROL}
        />
      )}
    </Field>
  )
}

/** Options are `[{ label, value }]` or bare strings, after binding resolution. */
function optionsOf(raw: unknown): { label: string; value: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((option) => {
      if (typeof option === "string") return { label: option, value: option }
      if (option && typeof option === "object") {
        const record = option as Record<string, unknown>
        const value = asText(record.value ?? record.label)
        const label = asText(record.label ?? record.value)
        if (value) return { label: label || value, value }
      }
      return null
    })
    .filter((option): option is { label: string; value: string } => option !== null)
}

export function Select({ props }: PrimitiveProps) {
  const { form, name, label, error } = useField(props, "select")
  const options = optionsOf(props.options)
  if (!form || !name) return null

  return (
    <Field name={name} label={label} error={error}>
      {/*
        A native select, not the shadcn one: it needs no portal, so it cannot
        hit the shadow-root portal problem, and mobile gets the OS picker.
      */}
      <select
        id={name}
        name={name}
        value={asText(form.values[name])}
        aria-invalid={Boolean(error)}
        onChange={(e) => form.setValue(name, e.target.value)}
        className={cn(CONTROL, "appearance-none")}
      >
        <option value="">{asText(props.placeholder) || "Select…"}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function Checkbox({ props }: PrimitiveProps) {
  const { form, name, label, error } = useField(props, "checkbox")
  if (!form || !name) return null

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label className="flex cursor-pointer items-start gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          name={name}
          checked={form.values[name] === true}
          onChange={(e) => form.setValue(name, e.target.checked)}
          className="mt-0.5 size-3.5 shrink-0 accent-primary"
        />
        <span className="min-w-0">{label}</span>
      </label>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function RadioGroup({ props }: PrimitiveProps) {
  const { form, name, label, error } = useField(props, "radio")
  const options = optionsOf(props.options)
  if (!form || !name) return null

  const selected = asText(form.values[name])

  return (
    <Field name={name} label={label} error={error}>
      <div
        role="radiogroup"
        className={cn(
          "flex gap-2",
          props.layout === "horizontal" ? "flex-row flex-wrap" : "flex-col"
        )}
      >
        {options.map((option) => {
          const active = selected === option.value
          return (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
                active
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => form.setValue(name, option.value)}
                className="size-3.5 shrink-0 accent-primary"
              />
              {option.label}
            </label>
          )
        })}
      </div>
    </Field>
  )
}
