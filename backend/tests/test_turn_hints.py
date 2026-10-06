from app.services.voice.config import VoiceSettings
from app.services.voice.turn_hints import endpointing_options
from app.services.voice.turn_hints import punctuation_kind


def test_thinking_or_incomplete_phrase_wins_over_asr_punctuation():
    settings = VoiceSettings()
    for text in ("I want to.", "Because...", "Um.", "Let me think.", "मुझे चाहिए क्योंकि।"):
        options = endpointing_options(text, settings, True)
        assert options["min_delay"] == 0.65
        assert options["max_delay"] == 1.0


def test_complete_final_question_is_fast_but_interim_punctuation_is_not():
    settings = VoiceSettings()
    question = "What are your opening hours?"
    assert endpointing_options(question, settings, True)["min_delay"] == 0.18
    assert endpointing_options(question, settings, False)["min_delay"] == settings.VOICE_ENDPOINTING_MIN_DELAY
    assert endpointing_options("Tell me your opening hours", settings, True)["min_delay"] == settings.VOICE_ENDPOINTING_MIN_DELAY
    assert endpointing_options("My number is 1234.", settings, True)["min_delay"] == 0.5


def test_weak_punctuation_and_ellipsis_are_not_strong_sentence_endings():
    settings = VoiceSettings()
    for text in ("Actually,", "The details:", "My question;", "I was thinking—"):
        assert punctuation_kind(text) == "weak"
        assert endpointing_options(text, settings, True)["min_delay"] == 0.5
    for text in ("I was thinking...", "I was thinking…"):
        assert punctuation_kind(text) == "hesitation"
        assert endpointing_options(text, settings, True)["min_delay"] == 0.65
    assert punctuation_kind('What time?"') == "strong"
