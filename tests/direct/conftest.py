"""Shared helpers for direct-mode tests.

The fixtures `direct_vm`, `direct_deploy`, `direct_alice` and `direct_bob`
are provided by the gltest pytest plugin, following the GenLayer project
boilerplate (genlayerlabs/genlayer-project-boilerplate).
"""


def to_hex(address) -> str:
    """Normalize an account/address fixture to its hex string form."""
    return address.as_hex if hasattr(address, "as_hex") else str(address)
