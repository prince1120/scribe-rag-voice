import asyncio
import sys
from app.services.owner_auth import hash_password, validate_password
from app.repositories.owners import get_owner_by_email, set_owner_credentials

async def reset(email: str, new_password: str):
    validate_password(new_password)
    owner = await get_owner_by_email(email)
    if not owner:
        print(f"Error: Account with email '{email}' not found.")
        return
    pwd_hash = hash_password(new_password)
    await set_owner_credentials(tenant_id=owner.tenant_id, email=email, password_hash=pwd_hash)
    print(f"Successfully reset password for {email} (Tenant: {owner.tenant_id}, Business: {owner.business_name})")

if __name__ == "__main__":
    email = sys.argv[1] if len(sys.argv) > 1 else "shiro@mail.com"
    new_password = sys.argv[2] if len(sys.argv) > 2 else "test@123"
    asyncio.run(reset(email, new_password))
