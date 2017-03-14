'use babel';

/**
 * Performs a binary search on the array using the target as a lower bound.
 * @return {Number} The index of the first element in the array that is *not less* that the target.
 */
function lowerBound(array, begin, end, target) {
  if (begin === end) return end;

  let middle = begin + Math.trunc((end - begin) / 2);
  const pivot = array[middle][0].range.start;

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
  const pivot = array[middle][0].range.start;

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
  const entry = array[bucket].findIndex(entry => entry.range.containsPoint(target));
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
  constructor(range, marker, originalText) {
    this.range = range;
    this.marker = marker;
    this.originalText = originalText;
  }

  hasSameRowAs(range) {
    return this.range.start == range.start.row;
  }
}

const expansions = Symbol.for('expansions');

/**
 *
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
  add(range, marker, originalText) {
    const index = findWith(lowerBound, this[expansions], range.start);
    const bucket = this[expansions][index];
    // Check if we found a bucket at all (not so when the array is empty) and if we found an entry
    // whose row is greater, or one whose row is equal.
    if (bucket && bucket[0].hasSameRowAs(range)) {
      bucket.push({range, marker, originalText});
    } else {
      this[expansions].splice(index, 0, [new Entry(range, marker, originalText)]);
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
    if (bucket.length == 0) {
      this[expansions].splice(index.bucket, 1);
    }

    return entry;
  }

  /**
   * Clears the set completely.
   */
  clear() {
    while (this[expansions].length > 0) {
      this[expansions].pop();
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
