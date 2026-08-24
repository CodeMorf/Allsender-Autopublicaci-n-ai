from pathlib import Path

middleware = Path('middleware.ts')
if not middleware.exists():
    raise SystemExit('No existe middleware.ts en la raíz del proyecto.')

s = middleware.read_text()
original = s

# Insertar flags después de pathWithoutLocale si no existen.
needle = "  const pathWithoutLocale = pathname.replace(/^\\/(pt|en|es)/, '') || '/';\n"
insert = """  const isMobileStaffLoginRoute = pathWithoutLocale === '/modulo/chat-mobile/login';
  const isMobileChatRoute =
    pathWithoutLocale === '/modulo/chat-mobile' ||
    pathWithoutLocale.startsWith('/modulo/chat-mobile/');
"""
if "isMobileStaffLoginRoute" not in s:
    if needle not in s:
        raise SystemExit('No encontré pathWithoutLocale en middleware.ts')
    s = s.replace(needle, needle + insert, 1)

old = "  const isProtectedRoute = protectedRoutes.some(route => pathWithoutLocale.startsWith(route));"
new = "  const isProtectedRoute = protectedRoutes.some(route => pathWithoutLocale.startsWith(route)) && !isMobileStaffLoginRoute;"
if old in s:
    s = s.replace(old, new, 1)

# Redirigir chat-mobile sin sesión a login propio, no al sign-in global.
old_block = """  if (isProtectedRoute && !sessionCookie) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in`, process.env.NEXT_PUBLIC_APP_URL || request.url));
  }
"""
new_block = """  if (isMobileChatRoute && !isMobileStaffLoginRoute && !sessionCookie) {
    return NextResponse.redirect(new URL(`/${locale}/modulo/chat-mobile/login`, process.env.NEXT_PUBLIC_APP_URL || request.url));
  }

  if (isProtectedRoute && !sessionCookie) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in`, process.env.NEXT_PUBLIC_APP_URL || request.url));
  }
"""
if old_block in s and "modulo/chat-mobile/login" not in s.split(old_block)[0]:
    s = s.replace(old_block, new_block, 1)

# En caso de token inválido en chat-mobile, volver al login propio.
old_invalid = """      if (isProtectedRoute) {
        return NextResponse.redirect(new URL(`/${locale}/sign-in`, process.env.NEXT_PUBLIC_APP_URL || request.url));
      }
"""
new_invalid = """      if (isMobileChatRoute && !isMobileStaffLoginRoute) {
        return NextResponse.redirect(new URL(`/${locale}/modulo/chat-mobile/login`, process.env.NEXT_PUBLIC_APP_URL || request.url));
      }
      if (isProtectedRoute) {
        return NextResponse.redirect(new URL(`/${locale}/sign-in`, process.env.NEXT_PUBLIC_APP_URL || request.url));
      }
"""
if old_invalid in s and "isMobileChatRoute && !isMobileStaffLoginRoute" not in s:
    s = s.replace(old_invalid, new_invalid, 1)

middleware.write_text(s)
print('OK mobile staff login middleware patch changed=', s != original)
