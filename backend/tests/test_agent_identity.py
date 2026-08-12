"""The owner's script decides who the assistant is.

Reported from a live call. The owner had written a pizza-ordering agent —
"You are PizzaScribe, a friendly pizza ordering assistant" — on a workspace
named "Shiro art and craft" with the agent named "Shiro". Asked what it did, the
assistant said it was Shiro, there to help pick art and craft supplies.

Nothing was wrong with the script. We appended this after it:

    WHO YOU ARE
    You are Shiro, the assistant for Shiro art and craft.
    Answer as that assistant, never as a general-purpose AI.

Two identities in one prompt, ours last and phrased as a command. The model did
what it was told — by us, over the owner.

The block is a fallback for scripts that never say who the assistant is, which
is what it was always documented to be. It is now only added when that is
actually the case.
"""
import pytest

from app.services import owner_service


PIZZA = (
    "You are PizzaScribe, a friendly pizza ordering assistant.\n\n"
    "Your job is to take customer food orders accurately and quickly."
)


def _prompt(script: str, **kw):
    return owner_service.build_agent_prompt(
        script=script,
        agent_name=kw.get("agent_name", "Shiro"),
        business_name=kw.get("business_name", "Shiro art and craft"),
        channel="voice",
        style_rules=kw.get("style_rules", True),
    )


class TestTheOwnersCharacterSurvives:
    def test_a_script_that_names_the_assistant_is_not_contradicted(self):
        """The regression: the reported call, exactly."""
        prompt = _prompt(PIZZA)
        assert "PizzaScribe" in prompt
        assert "WHO YOU ARE" not in prompt
        assert "the assistant for Shiro art and craft" not in prompt

    def test_the_business_name_does_not_leak_into_a_different_persona(self):
        prompt = _prompt(PIZZA)
        # The owner never mentioned the workspace name in their script, so it
        # has no business appearing in what the model is told to be.
        before_rules = prompt.split("HOW YOU SPEAK")[0]
        assert "Shiro" not in before_rules

    @pytest.mark.parametrize(
        "script",
        [
            "You are PizzaScribe, a pizza assistant.",
            "you're Rani, the front desk for a clinic.",
            "Your name is Alex. Answer billing questions.",
            "  \n You Are CoffeeBot, and you take coffee orders.",
        ],
    )
    def test_identity_is_recognised_however_it_is_phrased(self, script):
        assert owner_service._states_an_identity(script)


class TestTheFallbackStillExists:
    """An owner who writes only instructions still gets a coherent assistant —
    the reason the block was added in the first place."""

    def test_a_script_with_no_persona_gets_the_identity_block(self):
        prompt = _prompt("Answer questions about our opening hours and prices.")
        assert "WHO YOU ARE" in prompt
        assert "You are Shiro, the assistant for Shiro art and craft" in prompt

    def test_an_empty_script_gets_the_identity_block(self):
        prompt = _prompt("   ")
        assert "WHO YOU ARE" in prompt

    def test_a_rule_mentioning_you_are_is_not_mistaken_for_a_persona(self):
        """"If you are unsure, say so" is a rule, not a character. Checked only
        against the opening of the script for exactly this reason."""
        script = (
            "Answer questions about our menu and prices. Be brief and warm.\n"
            + ("Keep answers focused on what the customer asked. " * 12)
            + "If you are unsure about something, say so rather than guessing."
        )
        assert not owner_service._states_an_identity(script)
        assert "WHO YOU ARE" in _prompt(script)


class TestUnchangedBehaviour:
    def test_the_clock_is_always_appended(self):
        """Time-dependent answers are wrong from training data no matter who the
        assistant is, so this is not part of the identity trade-off."""
        assert "CURRENT DATE AND TIME" in _prompt(PIZZA)
        assert "CURRENT DATE AND TIME" in _prompt("Answer politely.")

    def test_delivery_rules_still_apply_to_a_named_persona(self):
        """Skipping the identity block must not skip how it speaks — the two are
        independent, and a pizza agent still has to sound like a phone call."""
        assert "HOW YOU SPEAK" in _prompt(PIZZA)

    def test_style_rules_off_still_honoured(self):
        assert "HOW YOU SPEAK" not in _prompt(PIZZA, style_rules=False)
