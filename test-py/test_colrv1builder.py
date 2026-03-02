def test_resolve_varspec_static():
    from fontra.core.colrv1builder import _resolve_varspec

    assert _resolve_varspec(100) == 100.0


def test_resolve_varspec_variable():
    from fontra.core.colrv1builder import _resolve_varspec

    val = {"default": 630, "keyframes": [{"axis": "SHDW", "loc": 1.0, "value": 130}]}
    result = _resolve_varspec(val)
    assert result == {(("SHDW", 1.0),): 130.0}


def test_resolve_varspec_no_keyframes():
    from fontra.core.colrv1builder import _resolve_varspec

    val = {"default": 630, "keyframes": []}
    result = _resolve_varspec(val)
    assert result == 630.0


def test_resolve_varspec_multiple_keyframes():
    from fontra.core.colrv1builder import _resolve_varspec

    val = {
        "default": 630,
        "keyframes": [
            {"axis": "SHDW", "loc": 0.5, "value": 430},
            {"axis": "SHDW", "loc": 1.0, "value": 130},
        ],
    }
    result = _resolve_varspec(val)
    assert result == {(("SHDW", 0.5),): 430.0, (("SHDW", 1.0),): 130.0}


def test_resolve_varspec_scalar_input():
    from fontra.core.colrv1builder import _resolve_varspec

    assert _resolve_varspec(42) == 42.0


def test_resolve_varspec_dict_default():
    from fontra.core.colrv1builder import _resolve_varspec

    assert _resolve_varspec({"default": 630}) == 630.0  # After bugfix


def test_resolve_varspec_error_fallback():
    from fontra.core.colrv1builder import _resolve_varspec

    val = {
        "default": 500,
        "keyframes": [{"axis": "wght", "loc": "invalid", "value": 100}],
    }
    result = _resolve_varspec(val)
    assert result == 500.0
