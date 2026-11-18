"""Current user's local macOS keychain. Secrets stay inside the server process."""
import ctypes as ct

security = ct.CDLL("/System/Library/Frameworks/Security.framework/Security")
foundation = ct.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
ptr = ct.c_void_p
uint = ct.c_uint32
service = "希息药事 · 科普工作台".encode()
not_found = -25300
duplicate = -25299

find_password = security.SecKeychainFindGenericPassword
find_password.argtypes = [ptr, uint, ct.c_char_p, uint, ct.c_char_p,
                          ct.POINTER(uint), ct.POINTER(ptr), ct.POINTER(ptr)]
add_password = security.SecKeychainAddGenericPassword
add_password.argtypes = [ptr, uint, ct.c_char_p, uint, ct.c_char_p, uint, ct.c_char_p, ptr]
modify_password = security.SecKeychainItemModifyAttributesAndData
modify_password.argtypes = [ptr, ptr, uint, ct.c_char_p]
security.SecKeychainItemFreeContent.argtypes = [ptr, ptr]
foundation.CFRelease.argtypes = [ptr]
foundation.CFRelease.restype = None


def check(status):
    if status:
        raise OSError(f"macOS 钥匙串操作失败（{status}）。请确认登录钥匙串已解锁且允许工作台访问。")


def read_password(account):
    account = account.encode()
    size, data = uint(), ptr()
    status = find_password(None, len(service), service, len(account), account,
                           ct.byref(size), ct.byref(data), None)
    if status == not_found:
        return ""
    check(status)
    try:
        return ct.string_at(data, size.value).decode("ascii")
    finally:
        security.SecKeychainItemFreeContent(None, data)


def write_password(account, value):
    account, value = account.encode(), value.encode("ascii")
    identity = (None, len(service), service, len(account), account)
    status = add_password(*identity, len(value), value, None)
    if status != duplicate:
        check(status)
        return
    item = ptr()
    check(find_password(*identity, None, None, ct.byref(item)))
    try:
        check(modify_password(item, None, len(value), value))
    finally:
        foundation.CFRelease(item)
