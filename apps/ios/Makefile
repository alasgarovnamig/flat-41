# EvTap iOS — convenience targets (run from apps/ios).
SIMULATOR ?= iPhone 16

.PHONY: bootstrap project open build test test-core locations check-strings clean

bootstrap: ## install XcodeGen
	brew install xcodegen

project: ## generate EvTap.xcodeproj from project.yml
	xcodegen generate

open: project
	open EvTap.xcodeproj

build: project
	xcodebuild -project EvTap.xcodeproj -scheme EvTap -configuration Debug \
		-destination 'platform=iOS Simulator,name=$(SIMULATOR)' build

test: project ## EvTapCore unit tests through the app scheme
	xcodebuild -project EvTap.xcodeproj -scheme EvTap \
		-destination 'platform=iOS Simulator,name=$(SIMULATOR)' test

test-core: ## EvTapCore tests with SwiftPM (macOS or Linux, Swift 6 toolchain)
	swift test --package-path Packages/EvTapCore

locations: ## regenerate EvTap/Resources/locations.json from packages/shared/src/locations.ts
	node scripts/gen-locations.mjs

check-strings: ## every L("…") key used in Swift exists in az / ru / en
	node scripts/check-strings.mjs

clean:
	rm -rf EvTap.xcodeproj Packages/EvTapCore/.build build DerivedData
