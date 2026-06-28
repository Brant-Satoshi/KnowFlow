"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { BrandLogo } from "@/components/brand-logo"
import { SettingsMenu } from "@/components/settings-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BRAND_NAME } from "@/lib/brand"
import { httpClient, HttpError } from "@/lib/http/client"
import { useErrorToast } from "@/lib/hooks/use-error-toast"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { useAuth } from "@/lib/auth/AuthContext"
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/validation"
import type { AuthUser } from "@/lib/auth/users"

export default function RegisterPage() {
  const { authT } = useLanguage()
  const { setUser } = useAuth()
  const router = useRouter()
  const errorToast = useErrorToast()

  const schema = useMemo(
    () =>
      z
        .object({
          email: z.string().email(authT.emailInvalid),
          password: z.string().min(MIN_PASSWORD_LENGTH, authT.passwordTooShort),
          confirmPassword: z.string(),
        })
        .refine((d) => d.password === d.confirmPassword, {
          message: authT.passwordsMismatch,
          path: ["confirmPassword"],
        }),
    [authT]
  )

  type FormValues = z.infer<typeof schema>

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (values: FormValues) => {
    try {
      const data = await httpClient.post<{ user: AuthUser }>("/api/auth/register", {
        email: values.email,
        password: values.password,
      })
      setUser(data.user)
      router.push("/")
    } catch (e) {
      const code = e instanceof HttpError ? (e.data as { code?: string })?.code : undefined
      errorToast(code === "EMAIL_TAKEN" ? authT.emailTaken : authT.genericError)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-13 items-center justify-between border-b border-border bg-background px-5">
        <BrandLogo
          name={BRAND_NAME}
          textClassName="truncate text-lg font-semibold tracking-[-0.04em] text-foreground"
        />
        <SettingsMenu />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{authT.registerTitle}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{authT.registerSubtitle}</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                {authT.emailLabel}
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={authT.emailPlaceholder}
                {...register("email")}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                {authT.passwordLabel}
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder={authT.passwordPlaceholder}
                {...register("password")}
              />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
                {authT.confirmPasswordLabel}
              </label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder={authT.confirmPasswordPlaceholder}
                {...register("confirmPassword")}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? authT.registering : authT.registerButton}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {authT.haveAccount}{" "}
            <Link href="/login" className="cursor-pointer font-medium text-primary hover:underline">
              {authT.signInLink}
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
