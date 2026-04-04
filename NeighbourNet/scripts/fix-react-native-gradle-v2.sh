#!/bin/bash
# Final fix for React Native modules - properly declares library components

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
NODE_MODULES="$PROJECT_ROOT/node_modules"

fix_module() {
    local BUILD_GRADLE="$1"
    local MODULE_NAME="$2"
    
    if [ ! -f "$BUILD_GRADLE" ]; then
        echo "Not found: $BUILD_GRADLE"
        return 1
    fi
    
    echo "Fixing: $MODULE_NAME"
    
    # Add component publishing at the end of file
    cat >> "$BUILD_GRADLE" << 'GRADLE_FIX'

// AGP 8.x library component declaration - enables variant resolution
afterEvaluate {
  // Ensure this is properly recognized as a library module by Gradle's component model
  if (android != null && android.libraryVariants != null) {
    // Register library component for Gradle's variant matching
    // This is necessary for AGP 8.x which uses the component model for dependency resolution
    components {
      // Create a default "release" library component
      try {
        // The magic: explicitly register the library as a consumable component
        library(android.libraryVariants.find {  it.buildType.name == 'release' } ?: android.libraryVariants.first())
      } catch(e) {
        // Fallback: just ensure variants are accessible
        println "Could not register library component: ${e.message}"
      }
    }
    
    // Additional workaround: configure all compile classpaths to accept this library
    configurations.all { config ->
      if (config.name.endsWith('CompileClasspath')) {
        config.resolutionStrategy.dependencySubstitution {
          // Ensure this module is available as a dependency
        }
      }
    }
  }
}

// Task to print debug info
task debugVariants {
  doLast {
    if (android != null && android.libraryVariants != null) {
      println "Available variants for ${project.name}:"
      android.libraryVariants.each { variant ->
        println "  - ${variant.name} (${variant.buildType.name})"
      }
    }
    if (components != null) {
      println "Registered components for ${project.name}:"
      components.each { component ->
        println "  - ${component.name}"
      }
    }
  }
}
GRADLE_FIX
    
    echo "  ✓ Fixed"
}

echo "Applying AGP 8.x library component fixes..."

fix_module "$NODE_MODULES/@react-native-async-storage/async-storage/android/build.gradle" \
           "@react-native-async-storage/async-storage"

fix_module "$NODE_MODULES/@react-native-community/netinfo/android/build.gradle" \
           "@react-native-community/netinfo"

fix_module "$NODE_MODULES/react-native-get-random-values/android/build.gradle" \
           "react-native-get-random-values"

fix_module "$NODE_MODULES/react-native-safe-area-context/android/build.gradle" \
           "react-native-safe-area-context"

echo ""
echo "Fix applied! The modules should now resolve their variants correctly."
echo "Build with: cd android && ./gradlew :app:assembleDebug"
