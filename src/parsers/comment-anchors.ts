import type {
  ScrivenerComment,
  ScrivenerCommentAnchor,
  ScrivenerRtfModel,
} from '../types.js';

interface CommentAnchorTarget {
  comments?: ScrivenerComment[];
  commentAnchors?: ScrivenerCommentAnchor[];
  rtfModel?: ScrivenerRtfModel;
}

export function linkCommentAnchors<T extends CommentAnchorTarget>(target: T): T {
  if (!target.comments?.length) {
    return target;
  }
  if (!target.commentAnchors?.length) {
    target.comments = target.comments.map((comment) => ({
      ...comment,
      hasAnchors: false,
    }));
    return target;
  }

  const commentIndexById = new Map(
    target.comments.map((comment, index) => [comment.id, index] as const),
  );
  const anchorFieldIndexesByComment = new Map<number, number[]>();

  target.commentAnchors = target.commentAnchors.map((anchor) => {
    const commentIndex = commentIndexById.get(anchor.commentId);
    if (commentIndex === undefined) {
      return anchor;
    }
    const fieldIndexes = anchorFieldIndexesByComment.get(commentIndex) ?? [];
    fieldIndexes.push(anchor.fieldIndex);
    anchorFieldIndexesByComment.set(commentIndex, fieldIndexes);
    return {
      ...anchor,
      commentIndex,
    };
  });

  target.comments = target.comments.map((comment, index) => {
    const anchorFieldIndexes = anchorFieldIndexesByComment.get(index);
    if (!anchorFieldIndexes?.length) {
      return {
        ...comment,
        hasAnchors: false,
      };
    }
    return {
      ...comment,
      anchorFieldIndexes,
      hasAnchors: true,
    };
  });

  if (target.rtfModel?.commentAnchors) {
    target.rtfModel = {
      ...target.rtfModel,
      commentAnchors: target.commentAnchors,
    };
  }

  return target;
}
