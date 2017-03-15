'use babel';

/**
 * Performs a binary search on the array using the target as a lower bound.
 * @return {Number} The index of the first element in the array that is *not less* that the target.
 */
function lowerBound(array, begin, end, target) {
  if (begin === end) return end;

  let middle = begin + Math.trunc((end - begin) / 2);
  const pivot = array[middle][0].start();

  if (target.row <= pivot.row) {
    return lowerBound(array, begin, middle, target);
  } else if (target.row > pivot.row) {
    return lowerBound(array, ++middle, end, target);
  }
}

/**
 * Performs a binary search on the sequence using the target as an upper bound.
 *
 * Note that this definition of 'upper bound' differs from that in C++, which finds the first
 * element in a sequence that is strictly greater. However, I see this as more conformant to
 * the naming of 'lower bound', which searches for an element using the target as the lower bound.
 * Symmetrically, this function searches for an element using the target as an upper bound.
 *
 * @return {Number} Looks for the first entry whose row is less than
 *         or equal to the row of the target point.
 */
function upperBound(array, begin, end, target) {
  if (begin === end) return begin - 1;

  let middle = begin + Math.trunc((end - begin) / 2);
  const pivot = array[middle][0].start();

  if (target.row < pivot.row) {
    return upperBound(array, begin, middle, target);
  } else if (target.row > pivot.row) {
    return upperBound(array, ++middle, end, target);
  } else {
    return middle;
  }
}

/**
 * Finds the first entry containing a target point.
 * @return {{bucket: Number}, {entry: Number}} An object containing the index
 *         of the bucket and of the entry containing the point.
 */
function indexOf(array, begin, end, target) {
  const bucket = upperBound(array, begin, end, target);
  if (bucket === -1) return null;
  // Find the first range that contains this point
  // Shouldn't be too many so linear search is fine.
  const entry = array[bucket].findIndex(entry => entry.range().containsPoint(target));
  return {bucket, entry};
}

/**
 * Executes a search algorithm on an array, looking for a target point.
 * @return {} Whatever the search algorithm returns.
 */
function findWith(method, array, target) {
  return method.call(null, array, 0, array.length, target);
}

class Entry {
  constructor(marker, originalText) {
    this.marker = marker;
    this.originalText = originalText;
  }

  range() {
    return this.marker.getBufferRange();
  }

  start() {
    return this.range().start;
  }

  top() {
    return this.start().row;
  }

  bottom() {
    return this.range().end.row;
  }

  contains(other) {
    return this.range().containsRange(other.range());
  }

  unexpand() {
    console.log('Unexpanding: ', this);
    if (this.marker.isValid()) {
      const editor = atom.workspace.getActiveTextEditor();
      editor.setSelectedBufferRange(this.marker.getBufferRange());
      editor.selectToEndOfLine();
      editor.transact(0, () => {
        editor.insertText(this.originalText, {select: true});
        editor.selectToBeginningOfLine();
        editor.autoIndentSelectedRows();
        editor.moveToFirstCharacterOfLine();
      });
    }
    this.marker.destroy();
  }
}

const expansions = Symbol.for('expansions');

/**
 * Stores an ordered multimap of expansions.
 *
 * Expansions are first ordered by the row of their starting point and then thrown into
 * a bag in case there are multiple expansions on one row. The set provides functions to efficiently
 * search, remove and insert new expansions in logarithmic time.
 */
export default class ExpansionSet {

  /**
   *
   */
  constructor() {
    this[expansions] = [];
  }

  /**
   * Adds a new entry to the set, consisting of a Range, a DisplayMarker and a string containing
   * the original text of the expansion. Upon deletion of this entry, the DisplayMarker will be
   * destroyed.
   */
  add(marker, originalText) {
    const entry = new Entry(marker, originalText);
    const index = findWith(lowerBound, this[expansions], entry.start());
    const bucket = this[expansions][index];
    // Check if we found a bucket at all (not so when the array is empty) and if we found an entry
    // whose row is greater, or one whose row is equal.
    if (bucket && bucket[0].top() === entry.top()) {
      bucket.push(entry);
    } else {
      this[expansions].splice(index, 0, [entry]);
    }
  }

  /**
   * Removes the first entry that contains the given point.
   */
  remove(point) {
    const index = findWith(indexOf, this[expansions], point);
    if (!index) return null;

    const bucket = this[expansions][index.bucket];
    const entry = bucket.splice(index.entry, 1)[0];

    // If there are multiple expansions starting at this row, we need to pick out
    // all those that the entry contains. In other words, we keep all those that
    // contain the entry (identical starting and ending row is impossible).
    for (let other = 0; other < bucket.length; ) {
      if (entry.contains(bucket[other])) {
        bucket[other].unexpand();
        console.log('same bucket');
        bucket.splice(other, 1);
      } else {
        ++other;
      }
    }

    // Find all top rows after the entry that come before the bottom row of the entry. Since entries
    // can only be fully contained, never partially, it holds that if an entry starts within the
    // range of the entry, it also ends in the range of the entry and must thus be invalidated.
    let count = 0;
    for (let after = index.bucket + 1; after < this[expansions].length; ++after) {
      if (this[expansions][after][0].top() <= entry.bottom()) {
        this[expansions][after].forEach(e => e.unexpand());
        console.log('bucket: ', after);
        count += 1;
      } else {
        break;
      }
    }

    if (bucket.length === 0) {
      this[expansions].splice(index.bucket, 1 + count);
    } else {
      this[expansions].splice(index.bucket + 1, count);
    }

    return entry;
  }

  /**
   * Clears the set completely, unexpanding all remaining expansions.
   */
  clear() {
    while (this[expansions].length > 0) {
      this[expansions].pop().unexpand();
    }
  }

  /**
   * Finds the first entry in the expansion set whose range
   * contains the given point, or null if no such entry exists.
   */
  find(point) {
    const index = findWith(indexOf, this[expansions], point);
    if (!index) return null;
    return this[expansions][index.bucket][index.entry];
  }
}
