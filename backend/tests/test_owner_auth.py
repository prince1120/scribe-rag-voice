"""Password handling for business owners.

Only business owners sign in. Personal users are identified by the keys they
already hold, and callers by the link they were sent — adding a password to
either would be asking for a credential twice.
"""
import pytest

from app.services import owner_auth


class TestHashing:
    def test_a_password_verifies_against_its_own_hash(self):
        stored = owner_auth.hash_password("correct horse battery")
        assert owner_auth.verify_password("correct horse battery", stored)

    def test_a_wrong_password_is_rejected(self):
        stored = owner_auth.hash_password("correct horse battery")
        assert not owner_auth.verify_password("Correct horse battery", stored)

    def test_the_password_is_not_recoverable_from_the_hash(self):
        stored = owner_auth.hash_password("hunter2hunter2")
        assert "hunter2hunter2" not in stored

    def test_identical_passwords_hash_differently(self):
        """Per-password salt: two owners choosing the same password must not
        share a stored value, or cracking one cracks both."""
        assert owner_auth.hash_password("same one") != owner_auth.hash_password("same one")

    def test_a_corrupt_stored_value_fails_closed(self):
        """A malformed row must fail the login rather than raise — a 500 here
        would itself reveal that the account exists."""
        assert not owner_auth.verify_password("anything", "not-a-real-hash")
        assert not owner_auth.verify_password("anything", "")
        assert not owner_auth.verify_password("anything", "bcrypt$aa$bb")

    def test_the_scheme_is_recorded_in_the_hash(self):
        """Stored with its algorithm so a future migration can re-hash on next
        login instead of locking everyone out."""
        assert owner_auth.hash_password("something long").startswith("scrypt$")


class TestValidation:
    def test_email_is_normalised(self):
        """Otherwise "Prince@X.com " and "prince@x.com" become two accounts."""
        assert owner_auth.validate_email("  Prince@Example.COM ") == "prince@example.com"

    @pytest.mark.parametrize("bad", ["", "no-at-sign", "a@b", "a b@c.com", "@x.com"])
    def test_obviously_wrong_emails_are_refused(self, bad):
        with pytest.raises(owner_auth.AuthError):
            owner_auth.validate_email(bad)

    def test_a_short_password_is_refused(self):
        with pytest.raises(owner_auth.AuthError, match="characters"):
            owner_auth.validate_password("short")

    def test_a_long_simple_passphrase_is_accepted(self):
        """Composition rules push people to "Password1!" — predictable, and
        weaker than length. Length is what actually resists guessing."""
        owner_auth.validate_password("all lowercase words no symbols")

    def test_the_minimum_is_not_trivially_low(self):
        assert owner_auth.MIN_PASSWORD_LENGTH >= 8


class TestSignupLoginFlow:
    @pytest.mark.asyncio
    async def test_full_owner_auth_lifecycle(self):
        from uuid import uuid4
        from httpx import ASGITransport, AsyncClient
        from app.main import app
        from app.database import engine, init_db

        await init_db()
        test_email = f"test_owner_{uuid4().hex[:6]}@example.com"
        test_password = "securePassword123"

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Signup
            signup_res = await client.post(
                "/api/v1/workspace/signup",
                json={
                    "email": test_email,
                    "password": test_password,
                    "business_name": "Test Clinic",
                    "business_category": "clinic",
                },
            )
            assert signup_res.status_code == 200
            data = signup_res.json()
            assert data["email"] == test_email
            assert data["business_name"] == "Test Clinic"

            cookie_header = signup_res.headers.get("set-cookie", "")
            import re
            m = re.search(r"scribe_session=([^;]+)", cookie_header)
            session_token = m.group(1) if m else signup_res.cookies.get("scribe_session")
            assert session_token is not None

            # 2. Get workspace with session cookie
            ws_res = await client.get(
                "/api/v1/workspace",
                cookies={"scribe_session": session_token},
            )
            assert ws_res.status_code == 200
            ws_data = ws_res.json()
            assert ws_data["business_name"] == "Test Clinic"
            assert ws_data["is_business"] is True

            # 3. Update profile
            prof_res = await client.put(
                "/api/v1/workspace/profile",
                json={"business_name": "Updated Clinic", "business_category": "services"},
                cookies={"scribe_session": session_token},
            )
            assert prof_res.status_code == 200
            assert prof_res.json()["business_name"] == "Updated Clinic"

            # 4. Logout
            logout_res = await client.post(
                "/api/v1/workspace/logout",
                cookies={"scribe_session": session_token},
            )
            assert logout_res.status_code == 200

            # 5. Login again with credentials
            login_res = await client.post(
                "/api/v1/workspace/login",
                json={"email": test_email, "password": test_password},
            )
            assert login_res.status_code == 200
            assert login_res.json()["business_name"] == "Updated Clinic"
            assert login_res.json()["email"] == test_email

        await engine.dispose()

