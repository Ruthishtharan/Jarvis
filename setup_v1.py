#!/usr/bin/env python3
"""
JARVIS V1 Setup Script — Install and configure all V1 features.

This script:
1. Installs required dependencies
2. Creates ~/.jarvis/ config directory
3. Generates default config
4. Registers startup daemon (optional)
5. Tests all features

Usage:
    python3 setup_v1.py
"""

import subprocess
import sys
from pathlib import Path

# Color codes for terminal output
GREEN = "\033[92m"
BLUE = "\033[94m"
YELLOW = "\033[93m"
RED = "\033[91m"
END = "\033[0m"


def print_header(text):
    """Print a section header."""
    print(f"\n{BLUE}{'=' * 70}{END}")
    print(f"{BLUE}{text:^70}{END}")
    print(f"{BLUE}{'=' * 70}{END}\n")


def print_success(text):
    """Print success message."""
    print(f"{GREEN}✓{END} {text}")


def print_error(text):
    """Print error message."""
    print(f"{RED}✗{END} {text}")


def print_info(text):
    """Print info message."""
    print(f"{BLUE}→{END} {text}")


def run_command(cmd, description):
    """Run a command and report status."""
    print_info(description)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print_success(description)
        return True
    except subprocess.CalledProcessError as e:
        print_error(f"{description} failed")
        print(f"  {e.stderr}")
        return False
    except Exception as e:
        print_error(f"{description} error: {e}")
        return False


def install_dependencies():
    """Install required Python packages."""
    print_header("Installing Dependencies")

    packages = [
        ("duckduckgo-search", "Web search library"),
        ("pyobjc-framework-Cocoa", "macOS integration"),
        ("pyobjc-framework-AppKit", "Menu bar app"),
    ]

    for package, description in packages:
        run_command(
            [sys.executable, "-m", "pip", "install", package],
            f"Installing {description} ({package})"
        )


def create_config():
    """Create ~/.jarvis/ config directory and default config."""
    print_header("Creating Configuration")

    config_dir = Path.home() / ".jarvis"
    config_file = config_dir / "config.json"

    # Create directory
    config_dir.mkdir(parents=True, exist_ok=True)
    print_success(f"Created config directory: {config_dir}")

    # Create default config if it doesn't exist
    if not config_file.exists():
        default_config = {
            "voice": "Samantha",
            "tts_rate": 160,
            "wake_word": "jarvis",
            "auto_start": True,
            "timezone": "Asia/Kolkata",
            "user_name": "Ruthish",
            "theme": "dark",
            "skills": {
                "web_search": True,
                "coding_assistant": True,
                "conversation": True,
                "system_control": True,
                "music": True,
            },
        }

        import json
        with open(config_file, "w") as f:
            json.dump(default_config, f, indent=2)
        print_success(f"Created default config: {config_file}")
        print(f"  You can edit this file to customize JARVIS")
    else:
        print_success(f"Config file already exists: {config_file}")


def setup_startup_daemon():
    """Setup macOS startup daemon."""
    print_header("Setting Up Startup Daemon")

    response = input(f"{YELLOW}Enable JARVIS to launch on system startup? (y/n) {END}")

    if response.lower() != "y":
        print_info("Skipped startup daemon setup")
        return

    # Run startup manager script
    jarvis_dir = Path(__file__).parent
    startup_script = jarvis_dir / "cli" / "startup_manager.py"

    if not startup_script.exists():
        print_error(f"Startup script not found: {startup_script}")
        return

    run_command(
        [sys.executable, str(startup_script), "--enable"],
        "Registering JARVIS startup daemon"
    )


def test_features():
    """Quick test of key features."""
    print_header("Testing Features")

    print_info("Testing imports...")
    try:
        # Test key imports
        from config.user_config import get_user_config
        from skills._registry import get_registry

        print_success("All imports working")

        config = get_user_config()
        print_success(f"Config loaded (voice: {config.get_voice()})")

        registry = get_registry()
        print_success(f"Skill registry loaded ({len(registry.all_skills())} skills)")

        # Route a representative utterance through each key skill.
        checks = [
            ("google python tutorials", "web_search"),
            ("how do i write an async function in python", "coding_assistant"),
            ("who is alan turing", "wikipedia_lookup"),
            ("tell me a joke", "jokes"),
            ("what is my cpu usage", "system_stats"),
            ("define ephemeral", "define_word"),
            ("give me the news", "news_headlines"),
        ]
        for utterance, expected in checks:
            skill, _ = registry.match(utterance)
            got = skill.name if skill else "no match"
            if got == expected:
                print_success(f"{expected} routes correctly")
            else:
                print_error(f"{expected}: {utterance!r} routed to {got}")

    except ImportError as e:
        print_error(f"Import error: {e}")
        return False

    return True


def print_next_steps():
    """Print next steps."""
    print_header("Setup Complete! 🎉")

    print(f"{GREEN}JARVIS V1 is now configured.{END}\n")

    print(f"{YELLOW}Next Steps:{END}")
    print(f"1. Run JARVIS:")
    print(f"   {BLUE}python3 /Users/ruthish/Projects/Jarvis.ai/run.py{END}")
    print(f"\n2. Test these commands:")
    print(f"   • 'jarvis search for python async'")
    print(f"   • 'jarvis how do i write async functions'")
    print(f"   • 'jarvis hello'")
    print(f"\n3. Customize settings (if desired):")
    print(f"   Edit: {BLUE}~/.jarvis/config.json{END}")
    print(f"\n4. See menu bar app:")
    print(f"   {BLUE}python3 cli/menu_bar_app.py{END}")
    print(f"   (Look for 🟢 JARVIS icon in top-right corner)")
    print(f"\n5. Ship to GitHub:")
    print(f"   {BLUE}git add -A && git commit -m 'Add V1 features' && git push{END}")

    print(f"\n{GREEN}Happy voice-commanding! 🚀{END}\n")


def main():
    """Main setup flow."""
    print_header("JARVIS V1 Setup")

    print("This script will:")
    print("  1. Install dependencies (web search, macOS integration)")
    print("  2. Create ~/.jarvis/ config directory")
    print("  3. Setup optional startup daemon")
    print("  4. Test all features")

    response = input(f"\n{YELLOW}Continue? (y/n) {END}")
    if response.lower() != "y":
        print_info("Setup cancelled")
        sys.exit(0)

    # Run setup steps
    try:
        install_dependencies()
        create_config()
        setup_startup_daemon()
        test_features()
        print_next_steps()
    except KeyboardInterrupt:
        print_error("Setup interrupted by user")
        sys.exit(1)
    except Exception as e:
        print_error(f"Setup failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
