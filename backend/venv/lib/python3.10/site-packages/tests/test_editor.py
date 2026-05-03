#!/usr/bin/env python
# vim: set et sw=4 sts=4 fileencoding=utf-8:

"""
Tests for the CompoundFileEditor functionality.
"""

import unittest
import tempfile
import os
from compoundfiles import CompoundFileWriter, CompoundFileReader, CompoundFileEditor


class TestCompoundFileEditor(unittest.TestCase):
    """
    Tests for CompoundFileEditor functionality.
    """
    
    def setUp(self):
        """
        Set up test fixtures.
        """
        self.temp_files = []
    
    def tearDown(self):
        """
        Clean up temporary files.
        """
        for temp_file in self.temp_files:
            if os.path.exists(temp_file):
                os.unlink(temp_file)
        self.temp_files = []
    
    def _create_temp_file(self):
        """
        Create a temporary file and track it for cleanup.
        """
        with tempfile.NamedTemporaryFile(delete=False, suffix='.cfb') as tmp:
            temp_filename = tmp.name
        self.temp_files.append(temp_filename)
        return temp_filename
    
    def _create_test_file(self, filename):
        """
        Create a test file with known structure.
        """
        with CompoundFileWriter(filename) as writer:
            # Create a stream
            writer.create_stream(writer.root, "test_stream", b"Hello, World!")
            
            # Create a storage with a stream inside
            storage = writer.create_storage(writer.root, "test_storage")
            writer.create_stream(storage, "inner_stream", b"Inner content")
            
            # Create another stream
            writer.create_stream(writer.root, "another_stream", b"Another content")
    
    def test_rename_stream(self):
        """
        Test renaming a stream.
        """
        temp_file = self._create_temp_file()
        self._create_test_file(temp_file)
        
        # Verify initial structure
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertIn("test_stream", root_items)
            self.assertNotIn("renamed_stream", root_items)
        
        # Rename the stream
        with CompoundFileEditor(temp_file) as editor:
            editor.rename("/test_stream", "renamed_stream")
            editor.save()
        
        # Verify the rename worked
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertNotIn("test_stream", root_items)
            self.assertIn("renamed_stream", root_items)
            
            # Verify content is preserved
            for item in reader.root:
                if item.name == "renamed_stream" and item.isfile:
                    with reader.open(item) as stream:
                        content = stream.read()
                        self.assertEqual(content, b"Hello, World!")
    
    def test_rename_storage(self):
        """
        Test renaming a storage.
        """
        temp_file = self._create_temp_file()
        self._create_test_file(temp_file)
        
        # Verify initial structure
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertIn("test_storage", root_items)
            self.assertNotIn("renamed_storage", root_items)
        
        # Rename the storage
        with CompoundFileEditor(temp_file) as editor:
            editor.rename("/test_storage", "renamed_storage")
            editor.save()
        
        # Verify the rename worked
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertNotIn("test_storage", root_items)
            self.assertIn("renamed_storage", root_items)
            
            # Verify the inner stream is still there
            for item in reader.root:
                if item.name == "renamed_storage" and item.isdir:
                    inner_items = [subitem.name for subitem in item]
                    self.assertIn("inner_stream", inner_items)
    
    def test_delete_stream(self):
        """
        Test deleting a stream.
        """
        temp_file = self._create_temp_file()
        self._create_test_file(temp_file)
        
        # Verify initial structure
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertIn("test_stream", root_items)
            self.assertIn("another_stream", root_items)
        
        # Delete a stream
        with CompoundFileEditor(temp_file) as editor:
            editor.delete("/test_stream")
            editor.save()
        
        # Verify the deletion worked
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertNotIn("test_stream", root_items)
            self.assertIn("another_stream", root_items)  # Other stream should remain
    
    def test_delete_storage(self):
        """
        Test deleting a storage and its contents.
        """
        temp_file = self._create_temp_file()
        self._create_test_file(temp_file)
        
        # Verify initial structure
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertIn("test_storage", root_items)
        
        # Delete the storage
        with CompoundFileEditor(temp_file) as editor:
            editor.delete("/test_storage")
            editor.save()
        
        # Verify the deletion worked
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertNotIn("test_storage", root_items)
    
    def test_add_stream(self):
        """
        Test adding a new stream.
        """
        temp_file = self._create_temp_file()
        self._create_test_file(temp_file)
        
        # Verify initial structure
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertNotIn("new_stream", root_items)
        
        # Add a new stream
        with CompoundFileEditor(temp_file) as editor:
            editor.add_stream("/", "new_stream", b"New content")
            editor.save()
        
        # Verify the addition worked
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertIn("new_stream", root_items)
            
            # Verify content is correct
            for item in reader.root:
                if item.name == "new_stream" and item.isfile:
                    with reader.open(item) as stream:
                        content = stream.read()
                        self.assertEqual(content, b"New content")
    
    def test_add_storage(self):
        """
        Test adding a new storage.
        """
        temp_file = self._create_temp_file()
        self._create_test_file(temp_file)
        
        # Verify initial structure
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertNotIn("new_storage", root_items)
        
        # Add a new storage
        with CompoundFileEditor(temp_file) as editor:
            editor.add_storage("/", "new_storage")
            editor.save()
        
        # Verify the addition worked
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertIn("new_storage", root_items)
            
            # Verify it's a storage
            for item in reader.root:
                if item.name == "new_storage":
                    self.assertTrue(item.isdir)
    
    def test_add_stream_to_storage(self):
        """
        Test adding a stream to an existing storage.
        """
        temp_file = self._create_temp_file()
        self._create_test_file(temp_file)
        
        # Add a stream to the existing storage
        with CompoundFileEditor(temp_file) as editor:
            editor.add_stream("/test_storage", "added_inner_stream", b"Added inner content")
            editor.save()
        
        # Verify the addition worked
        with CompoundFileReader(temp_file) as reader:
            for item in reader.root:
                if item.name == "test_storage" and item.isdir:
                    inner_items = [subitem.name for subitem in item]
                    self.assertIn("added_inner_stream", inner_items)
                    
                    # Verify content
                    for subitem in item:
                        if subitem.name == "added_inner_stream" and subitem.isfile:
                            with reader.open(subitem) as stream:
                                content = stream.read()
                                self.assertEqual(content, b"Added inner content")
    
    def test_complex_operations_sequence(self):
        """
        Test a sequence of operations: rename, add, delete.
        """
        temp_file = self._create_temp_file()
        self._create_test_file(temp_file)
        
        # Step 1: Rename a stream
        with CompoundFileEditor(temp_file) as editor:
            editor.rename("/test_stream", "renamed_stream")
            editor.save()
        
        # Step 2: Add a new stream
        with CompoundFileEditor(temp_file) as editor:
            editor.add_stream("/", "new_stream", b"New content")
            editor.save()
        
        # Step 3: Delete a stream
        with CompoundFileEditor(temp_file) as editor:
            editor.delete("/another_stream")
            editor.save()
        
        # Verify final structure
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            
            # Should have renamed stream
            self.assertIn("renamed_stream", root_items)
            self.assertNotIn("test_stream", root_items)
            
            # Should have new stream
            self.assertIn("new_stream", root_items)
            
            # Should not have deleted stream
            self.assertNotIn("another_stream", root_items)
            
            # Should still have storage
            self.assertIn("test_storage", root_items)
    
    def test_rename_with_children(self):
        """
        Test renaming a storage preserves its children.
        """
        temp_file = self._create_temp_file()
        self._create_test_file(temp_file)
        
        # Rename the storage
        with CompoundFileEditor(temp_file) as editor:
            editor.rename("/test_storage", "renamed_storage")
            editor.save()
        
        # Verify the storage and its children exist with new name
        with CompoundFileReader(temp_file) as reader:
            root_items = [item.name for item in reader.root]
            self.assertIn("renamed_storage", root_items)
            self.assertNotIn("test_storage", root_items)
            
            # Check that inner stream is still there
            for item in reader.root:
                if item.name == "renamed_storage" and item.isdir:
                    inner_items = [subitem.name for subitem in item]
                    self.assertIn("inner_stream", inner_items)
    
    def test_error_conditions(self):
        """
        Test error conditions.
        """
        temp_file = self._create_temp_file()
        self._create_test_file(temp_file)
        
        # Test renaming to existing name
        with CompoundFileEditor(temp_file) as editor:
            with self.assertRaises(Exception):  # Should raise some kind of error
                editor.rename("/test_stream", "another_stream")  # another_stream already exists
        
        # Test deleting non-existent entity
        with CompoundFileEditor(temp_file) as editor:
            with self.assertRaises(Exception):  # Should raise some kind of error
                editor.delete("/non_existent_stream")
        
        # Test adding stream with existing name
        with CompoundFileEditor(temp_file) as editor:
            with self.assertRaises(Exception):  # Should raise some kind of error
                editor.add_stream("/", "test_stream", b"dummy")  # test_stream already exists


if __name__ == '__main__':
    unittest.main()