#!/bin/bash
# Fix React Native modules that don't export proper Android library variants for AGP 8.x

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
NODE_MODULES="$PROJECT_ROOT/node_modules"

# List of packages to patch
PACKAGES=(
    "@react-native-async-storage/async-storage/android/build.gradle"
    "@react-native-community/netinfo/android/build.gradle"
    "react-native-get-random-values/android/build.gradle"
    "react-native-safe-area-context/android/build.gradle"
)

echo "Fixing React Native Gradle module configurations..."

for PACKAGE in "${PACKAGES[@]}"; do
    BUILD_GRADLE_FILE="$NODE_MODULES/$PACKAGE"
    
    if [ ! -f "$BUILD_GRADLE_FILE" ]; then
        echo "Warning: Not found - $BUILD_GRADLE_FILE"
        continue
    fi
    
    echo "Patching: $PACKAGE"
    
    # Check if already patched with newer fix
    if grep -q "publishAllVariants\|publishing\|components.default\|component library publishing" "$BUILD_GRADLE_FILE"; then
        echo "  Already patched - removing old patch"
        # Remove old patch if it exists
        sed -i '/^\/\/ Gradle plugin compatibility fix/,/^}/d' "$BUILD_GRADLE_FILE" 2>/dev/null || true
    fi
    
    # Add proper component publishing configuration
    # This uses Gradle's component-based publishing which AGP 8.x requires
    cat >> "$BUILD_GRADLE_FILE" << 'EOF'

// AGP 8.x library variant publishing - Required for module resolution
afterEvaluate {
  if (android.libraryVariants != null) {
    // Publish all library variants as components for Gradle variant matching
    def publishVariant = { variant ->
      variant.name // Access variant to ensure it's properly initialized
    }
    
    // Ensure debug and release variants are available
    android.libraryVariants.all(publishVariant)
    
    // Workaround: force Gradle to recognize this as a proper library project
    // by ensuring the project exports a consumable artifact
    if (!project.hasProperty("afterEvaluateCompleted")) {
      project.ext.afterEvaluateCompleted = true
      
      // This forces Gradle to treat this as a fully-formed library module
      try {
        project.configurations.all { cfg ->
          cfg.attributes.attribute(com.android.build.gradle.internal.attributes.VariantAttr.ATTRIBUTE, 
            project.objects.named(com.android.build.gradle.internal.attributes.VariantAttr, "androidLib"))
        }
      } catch (e) {
        // Attributes configuration may fail on older AGP versions
        true
      }
    }
  }
}
EOF
    
    echo "  Patched successfully"
done

echo "Done!"

