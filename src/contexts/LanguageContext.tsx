import React, { createContext, useContext } from "react"
import type { LangCode } from "../core/i18n"
import { t as tFn, type StringKey } from "../core/i18n"

interface LanguageContextValue {
  lang: LangCode
  setLang: (lang: LangCode) => void
  t: (key: StringKey, params?: Record<string, string | number>) => string
}

export const LanguageContext = createContext<LanguageContextValue>({
  lang: "uk",
  setLang: () => {},
  t: (key) => key,
})

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext)
}

export function makeT(lang: LangCode): (key: StringKey, params?: Record<string, string | number>) => string {
  return (key, params) => tFn(lang, key, params)
}
