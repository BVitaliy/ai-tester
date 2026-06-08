// Form intelligence. Detects fields, infers their type and validation rules, and
// generates valid / invalid / boundary inputs so the test designer can exercise
// real validation behaviour instead of only "submit empty".

const INPUT_CLASS_RE = /edittext|textfield|securetextfield|searchfield|input/i

function labelOf(el) {
  return (el.label || el.text || el.contentDesc || el.resourceId || "").trim()
}

function classify(el) {
  const hay = `${labelOf(el)} ${el.resourceId ?? ""} ${el.className ?? ""}`.toLowerCase()
  if (/securetextfield|password|пароль/.test(hay)) return "password"
  if (/email|e-mail|пошта|mail/.test(hay)) return "email"
  if (/phone|tel|mobile|телефон|номер/.test(hay)) return "phone"
  if (/date|birth|дата|народж/.test(hay)) return "date"
  if (/(\bage\b|\bqty\b|quantity|number|amount|кількість|сума|вік)/.test(hay)) return "number"
  if (/name|ім'я|імя|прізвище|firstname|lastname/.test(hay)) return "name"
  if (/search|пошук/.test(hay)) return "search"
  return "text"
}

const GENERATORS = {
  email: {
    rules: ["must contain @ and a domain"],
    valid: "qa.tester@example.com",
    invalid: "qa.tester(at)example",
    boundary: "a@b.co"
  },
  password: {
    rules: ["min length (often 8)", "letters + digits", "sometimes special chars"],
    valid: "Test12345!",
    invalid: "123",
    boundary: "Test123"
  },
  phone: {
    rules: ["digits only", "country code", "length 10-13"],
    valid: "+380501234567",
    invalid: "12ab",
    boundary: "+38050123456"
  },
  date: {
    rules: ["valid calendar date", "not in the future for birth dates"],
    valid: "1990-01-15",
    invalid: "2099-13-40",
    boundary: "2000-02-29"
  },
  number: {
    rules: ["numeric", "within allowed range"],
    valid: "5",
    invalid: "-1",
    boundary: "0"
  },
  name: {
    rules: ["non-empty", "letters"],
    valid: "Test User",
    invalid: "",
    boundary: "A"
  },
  search: {
    rules: ["non-empty query"],
    valid: "test",
    invalid: "",
    boundary: "a"
  },
  text: {
    rules: ["non-empty"],
    valid: "Test value",
    invalid: "",
    boundary: "x"
  }
}

function isRequired(el) {
  const hay = `${labelOf(el)} ${el.resourceId ?? ""}`.toLowerCase()
  // Required if it looks like a credential/contact field, or explicitly marked.
  if (/\*|required|обов'язков|обовязков/.test(hay)) return true
  return /password|email|пароль|пошта|phone|телефон|login|логін/.test(hay)
}

// Accepts either a screen record (clickableElements) or a raw UI tree
// ({ elements }). The raw UI tree is preferred when available because some input
// fields are not "clickable" but are focusable.
export function analyzeForm(input) {
  const elements = input?.elements ?? input?.clickableElements ?? []
  const fieldEls = elements.filter((el) => INPUT_CLASS_RE.test(el.className ?? ""))

  const fields = fieldEls.map((el) => {
    const type = classify(el)
    const gen = GENERATORS[type] ?? GENERATORS.text
    return {
      label: labelOf(el) || type,
      type,
      required: isRequired(el),
      validationRules: gen.rules,
      inputs: { valid: gen.valid, invalid: gen.invalid, boundary: gen.boundary }
    }
  })

  const submitEl = elements.find((el) =>
    /\b(submit|save|continue|login|sign in|register|next|надіслати|зберегти|увійти|зареєстр|далі)\b/i.test(labelOf(el)) &&
    !INPUT_CLASS_RE.test(el.className ?? "")
  )

  return {
    isForm: fields.length > 0,
    fieldCount: fields.length,
    requiredCount: fields.filter((f) => f.required).length,
    hasPassword: fields.some((f) => f.type === "password"),
    submitLabel: submitEl ? labelOf(submitEl) : null,
    fields
  }
}

// Builds the field-fill steps for a happy/negative/boundary case using the
// existing runner's step shape (action: "input"/"tap").
export function buildFormSteps(form, variant = "valid") {
  const steps = []
  for (const field of form.fields) {
    const value = field.inputs[variant] ?? field.inputs.valid
    steps.push({
      action: "input",
      target: field.label,
      value,
      description: `Enter ${variant} ${field.type} into "${field.label}"`
    })
  }
  if (form.submitLabel) {
    steps.push({ action: "tap", target: form.submitLabel, description: `Submit via "${form.submitLabel}"` })
  }
  return steps
}
