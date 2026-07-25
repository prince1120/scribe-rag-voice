import pytest

from app.services.voice.registry import ProviderRegistry, default_registry


def _fake_factory(settings):
    return object()


@pytest.fixture
def registry():
    return ProviderRegistry()


class TestProviderRegistration:
    def test_register_and_get_stt(self, registry):
        registry.register_stt("fake", _fake_factory)
        assert registry.get_stt("fake") is _fake_factory

    def test_register_and_get_tts(self, registry):
        registry.register_tts("fake", _fake_factory)
        assert registry.get_tts("fake") is _fake_factory

    def test_register_and_get_llm(self, registry):
        registry.register_llm("fake", _fake_factory)
        assert registry.get_llm("fake") is _fake_factory

    def test_stt_tts_llm_namespaces_are_independent(self, registry):
        # Registering under one kind must not make it resolvable under another.
        registry.register_stt("fake", _fake_factory)
        with pytest.raises(ValueError):
            registry.get_tts("fake")
        with pytest.raises(ValueError):
            registry.get_llm("fake")


class TestUnknownProvider:
    def test_unknown_stt_raises_with_available_names_listed(self, registry):
        registry.register_stt("sarvam", _fake_factory)
        with pytest.raises(ValueError, match="Unknown STT provider 'deepgram'.*sarvam"):
            registry.get_stt("deepgram")

    def test_empty_registry_raises_with_none_registered_message(self, registry):
        with pytest.raises(ValueError, match=r"\(none registered\)"):
            registry.get_llm("anything")


class TestDefaultRegistry:
    def test_ships_with_sarvam_stt_tts_and_groq_llm(self):
        registry = default_registry()
        # Construction doesn't make network calls, safe to resolve — actually
        # building the client would require real API keys, so we only check
        # the factories are registered, not invoke them.
        assert registry.get_stt("sarvam") is not None
        assert registry.get_tts("sarvam") is not None
        assert registry.get_llm("groq") is not None

    def test_adding_a_new_provider_does_not_require_touching_existing_ones(self):
        # Demonstrates the extensibility contract: registering a new provider
        # is additive and leaves the built-ins untouched.
        registry = default_registry()
        registry.register_stt("fake-vendor", _fake_factory)
        assert registry.get_stt("sarvam") is not None
        assert registry.get_stt("fake-vendor") is _fake_factory
